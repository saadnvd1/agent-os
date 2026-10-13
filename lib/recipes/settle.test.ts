import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { makeRecipe, makeSession } from "./test-fixtures";

const finals = new Map<string, string>();
const chat = new Map<string, string | null>();
const done: string[] = [];

vi.mock("../session-logs/gather", () => ({
  finalMessage: (id: string) => finals.get(id) ?? null,
  usageRows: () => [{ costUsd: 0.5 }, { costUsd: 0.25 }],
}));
vi.mock("../chat/runner", () => ({
  chatStateNow: async (id: string) => chat.get(id) ?? "idle",
}));
vi.mock("../done", () => ({
  doneSession: async (id: string) => {
    done.push(id);
  },
}));

const { settleRuns, IDLE_SETTLE_MS, judge } = await import("./settle");
const { getRun } = await import("./store");

function liveRun(
  recipeId: string,
  sessionId: string | null,
  fields: { status?: string; trigger?: string; seq?: number } = {}
) {
  return Number(
    db
      .prepare(
        `INSERT INTO recipe_runs (recipe_id, seq, trigger, prompt, status, session_id, started_at)
         VALUES (?, ?, ?, 'p', ?, ?, datetime('now', '-10 minutes'))`
      )
      .run(
        recipeId,
        fields.seq ?? 1,
        fields.trigger ?? "manual",
        fields.status ?? "running",
        sessionId
      ).lastInsertRowid
  );
}

const events = (ws: string) =>
  db
    .prepare(`SELECT key, line FROM orchestrator_events WHERE workspace_id = ?`)
    .all(ws) as { key: string; line: string }[];

const noModel = async () => {
  throw new Error("no model");
};

describe("settleRuns: session recipes", () => {
  beforeEach(() => {
    finals.clear();
    chat.clear();
    done.length = 0;
  });

  it("settles on the RESULT line once the turn ended, then marks it Done", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(
      s,
      "Uploaded.\nRESULT: ok build=143 version=1.4.2 — On TestFlight"
    );
    const id = liveRun(r.id, s);
    expect(await settleRuns(Date.now(), noModel)).toBe(1);
    const run = getRun(id)!;
    expect(run).toMatchObject({
      status: "succeeded",
      summary: "On TestFlight",
      summary_source: "line",
      outputs: { build: "143", version: "1.4.2" },
      cost_usd: 0.75,
    });
    expect(run.duration_ms).toBeGreaterThan(9 * 60_000);
    expect(done).toEqual([s]);
  });

  it("waits while the turn is still running", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(s, "RESULT: ok");
    chat.set(s, "running");
    const id = liveRun(r.id, s);
    expect(await settleRuns(Date.now(), noModel)).toBe(0);
    expect(getRun(id)!.status).toBe("running");
  });

  it("a failed line settles failed and tells the orchestrator", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(s, "RESULT: failed — signing key expired");
    const id = liveRun(r.id, s, { trigger: "timer" });
    await settleRuns(Date.now(), noModel);
    expect(getRun(id)!.status).toBe("failed");
    expect(done).toEqual([]);
    expect(events(r.workspace_id)[0].line).toContain("signing key expired");
  });

  it("a BLOCKED line blocks the run", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(s, "BLOCKED: needs the signing password");
    const id = liveRun(r.id, s);
    await settleRuns(Date.now(), noModel);
    expect(getRun(id)).toMatchObject({
      status: "blocked",
      summary: "needs the signing password",
    });
  });

  it("success is silent for a timer run and reported for the orchestrator's", async () => {
    const quiet = makeRecipe({ name: "Quiet" });
    const loud = makeRecipe({ name: "Loud" });
    for (const [r, trigger] of [
      [quiet, "timer"],
      [loud, "tool"],
    ] as const) {
      const s = makeSession();
      finals.set(s, "RESULT: ok build=9 — fine");
      liveRun(r.id, s, { trigger });
    }
    await settleRuns(Date.now(), noModel);
    expect(events(quiet.workspace_id)).toHaveLength(0);
    expect(events(loud.workspace_id)[0].line).toContain("build=9");
  });

  it("settles by the model after the idle wait when there is no line", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(s, "Everything went through and build 12 is up.");
    const id = liveRun(r.id, s);
    const model = vi.fn(async () => ({
      ok: true,
      outputs: { build: "12", "Bad key": "x" },
      summary: "Build 12 is up",
    }));
    const t0 = Date.now();
    await settleRuns(t0, model);
    expect(getRun(id)!.status).toBe("running");
    await settleRuns(t0 + IDLE_SETTLE_MS + 1000, model);
    expect(getRun(id)).toMatchObject({
      status: "succeeded",
      summary_source: "model",
      outputs: { build: "12" },
    });
  });

  it("falls back to the state alone when the model fails too", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(s, "no idea");
    const id = liveRun(r.id, s);
    const t0 = Date.now();
    await settleRuns(t0, noModel);
    await settleRuns(t0 + IDLE_SETTLE_MS + 1000, noModel);
    expect(getRun(id)).toMatchObject({
      status: "failed",
      summary_source: "state",
      summary: "Ended without a result line",
    });
  });

  it("times out a run over its limit and leaves the session running", async () => {
    const r = makeRecipe({ maxMinutes: 5 });
    const s = makeSession();
    chat.set(s, "running");
    const id = liveRun(r.id, s);
    await settleRuns(Date.now(), noModel);
    expect(getRun(id)!.status).toBe("timed_out");
    expect(done).toEqual([]);
  });

  it("is idempotent across two loops: one event, one Done", async () => {
    const r = makeRecipe();
    const s = makeSession();
    finals.set(s, "RESULT: failed — nope");
    liveRun(r.id, s);
    await settleRuns(Date.now(), noModel);
    await settleRuns(Date.now(), noModel);
    expect(events(r.workspace_id)).toHaveLength(1);
  });

  it("fails a start that a restart cut off", async () => {
    const r = makeRecipe();
    const id = liveRun(r.id, null, { status: "starting" });
    db.prepare(
      `UPDATE recipe_runs SET created_at = datetime('now', '-1 hour') WHERE id = ?`
    ).run(id);
    await settleRuns(Date.now(), noModel);
    expect(getRun(id)!.status).toBe("failed");
  });
});

describe("settleRuns: task recipes", () => {
  it("merged is a success, dropped a failure, and the PR is copied", async () => {
    const r = makeRecipe({ kind: "task", name: "Audit" });
    const merged = makeSession({
      task_status: "merged",
      pr_number: 91,
      pr_url: "u",
    });
    finals.set(merged, "PR is up.\nRESULT: ok report=docs/audit.md");
    const a = liveRun(r.id, merged);
    await settleRuns(Date.now(), noModel);
    expect(getRun(a)).toMatchObject({
      status: "succeeded",
      pr_number: 91,
      outputs: { report: "docs/audit.md" },
    });
    const dropped = makeSession({ task_status: "dropped" });
    finals.set(dropped, "RESULT: ok — all good");
    const b = liveRun(r.id, dropped, { seq: 2 });
    await settleRuns(Date.now(), noModel);
    expect(getRun(b)!.status).toBe("failed");
    expect(done).toEqual([]);
  });

  it("a queued run starts counting when its session exists", async () => {
    const r = makeRecipe({ kind: "task", name: "Queued" });
    const s = makeSession({ task_status: "running" });
    const id = liveRun(r.id, s, { status: "queued" });
    await settleRuns(Date.now(), noModel);
    expect(getRun(id)!.status).toBe("running");
  });
});

describe("judge", () => {
  it("never lets the line turn a failure into a success", () => {
    const line = { ok: true, outputs: {}, summary: "fine" };
    expect(judge("failed", line, "Dropped").status).toBe("failed");
    expect(judge("timed_out", line, "").status).toBe("timed_out");
    expect(judge("succeeded", { ...line, ok: false }, "").status).toBe(
      "failed"
    );
    expect(judge("succeeded", null, "Merged #3").summary).toBe("Merged #3");
  });
});
