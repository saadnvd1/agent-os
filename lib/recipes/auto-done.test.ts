import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { saveItem } from "../chat/store";
import { needsYou } from "../needs-you";
import { inBell } from "../sidebar/shelves";
import { makeRecipe, makeSession } from "./test-fixtures";

// The real settle loop and the real Done; only the outside world is faked.
const finals = new Map<string, string>();

vi.mock("../session-logs/gather", () => ({
  finalMessage: (id: string) => finals.get(id) ?? null,
  usageRows: () => [],
}));
vi.mock("../chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat/runner")>()),
  chatStateNow: async () => "idle",
  chatState: () => null,
  stopChat: () => {},
}));
vi.mock("../hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));
vi.mock("../status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    listSessions: async () => [],
    cleanup: () => {},
    hostErrors: () => ({}),
    sessionExists: () => false,
    getStatus: async () => "dead",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "",
  },
}));

const { settleRuns } = await import("./settle");
const { getRun } = await import("./store");

const noModel = async () => {
  throw new Error("no model");
};

function run(recipeId: string, sessionId: string) {
  saveItem(sessionId, {
    id: randomUUID(),
    kind: "turn_end",
    createdAt: Date.now(),
  });
  return Number(
    db
      .prepare(
        `INSERT INTO recipe_runs (recipe_id, seq, trigger, prompt, status, session_id, started_at)
         VALUES (?, 1, 'tool', 'p', 'running', ?, datetime('now', '-10 minutes'))`
      )
      .run(recipeId, sessionId).lastInsertRowid
  );
}

const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Parameters<
    typeof needsYou
  >[0] &
    Parameters<typeof inBell>[0];

describe("auto_done session recipe runs", () => {
  beforeEach(() => finals.clear());

  it.each([
    ["ok", "RESULT: ok build=4 — uploaded", "succeeded"],
    ["failed", "RESULT: failed — key expired", "failed"],
  ])(
    "a run that reports %s ends Done and out of the bell",
    async (_n, line, status) => {
      const r = makeRecipe();
      const s = makeSession();
      finals.set(s, line);
      const id = run(r.id, s);
      expect(needsYou(row(s), "idle")).toBe(true);

      await settleRuns(Date.now(), noModel);

      expect(getRun(id)!.status).toBe(status);
      const after = row(s);
      expect(after.settled_at).toBeTruthy();
      expect(after.archived_at).toBeNull();
      expect(needsYou(after, "idle")).toBe(false);
      expect(inBell(after, { status: "idle" }, Date.now())).toBe(false);
      const event = db
        .prepare(`SELECT line FROM orchestrator_events WHERE workspace_id = ?`)
        .get(r.workspace_id) as { line: string };
      expect(event.line).toContain(
        status === "failed" ? "failed" : "finished ok"
      );
    }
  );

  it("a run with auto_done off stays as it is", async () => {
    const r = makeRecipe({ autoDone: false });
    const s = makeSession();
    finals.set(s, "RESULT: ok — fine");
    run(r.id, s);
    await settleRuns(Date.now(), noModel);
    const after = row(s);
    expect(after.settled_at).toBeNull();
    expect(needsYou(after, "idle")).toBe(true);
  });
});
