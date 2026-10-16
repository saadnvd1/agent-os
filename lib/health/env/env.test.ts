import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { HEALTH_DEFAULTS, type HealthConfig } from "../config";
import { MIN } from "../types";
import { noteToolResult, recordHit } from "./recordHit";
import { STALE_MS, sendFixNotes, type NoteDeps } from "./sendFixNotes";
import { raiseAlerts, type AlertDeps } from "./raiseAlerts";
import { envSessions, envSummary } from "./summarize";
import { fixFor, setFix } from "./fixText";
import { resetEnv, seedSession } from "./helpers.test-util";

const NOW = Date.parse("2026-10-16T18:00:00Z");
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const hit = (cls = "python-missing-module") => ({
  class: cls,
  line: "ModuleNotFoundError: No module named 'x'",
  command: "python3 run.py",
});
const rows = () =>
  db.prepare(`SELECT * FROM env_failures ORDER BY id`).all() as {
    session_id: string;
    hits: number;
    nudged_at: number | null;
    nudge_skipped: string | null;
    alerted: string | null;
  }[];

beforeEach(() => {
  resetEnv();
  setFix("python-missing-module", null);
});

describe("recording", () => {
  it("is one row per session and class; the same item twice is one hit", () => {
    seedSession("env-a");
    recordHit("env-a", "i1", hit(), NOW);
    recordHit("env-a", "i1", hit(), NOW + 1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].hits).toBe(1);
    recordHit("env-a", "i2", hit(), NOW + 2);
    expect(rows()[0].hits).toBe(2);
    recordHit("env-a", "i3", hit("python-not-found"), NOW);
    seedSession("env-b");
    recordHit("env-b", "i1", hit(), NOW);
    expect(rows()).toHaveLength(3);
  });

  it("reads a finished tool item, and ignores a running one or no output", () => {
    seedSession("env-a");
    const tool = (over: Partial<Extract<ChatItem, { kind: "tool" }>>) =>
      ({
        id: "t1",
        kind: "tool",
        name: "Bash",
        title: "",
        input: { command: "python3 x.py" },
        status: "error",
        output: "ModuleNotFoundError: No module named 'x'",
        createdAt: NOW,
        ...over,
      }) as Extract<ChatItem, { kind: "tool" }>;
    noteToolResult("env-a", tool({ status: "running" }));
    noteToolResult("env-a", tool({ output: undefined }));
    expect(rows()).toHaveLength(0);
    noteToolResult("env-a", tool({}));
    expect(rows()).toHaveLength(1);
  });
});

function noteDeps(over: Partial<NoteDeps> = {}) {
  const send = vi.fn(async (_id: string, _body: string) => {});
  return { send, deps: { send, blocked: () => false, ...over } as NoteDeps };
}

describe("the fix note", () => {
  it("is sent once per session and class, never again", async () => {
    seedSession("env-a");
    recordHit("env-a", "i1", hit(), NOW);
    const { send, deps } = noteDeps();
    expect(await sendFixNotes(NOW + MIN, deps)).toBe(1);
    expect(send.mock.calls[0][1]).toContain("Python module not found");
    recordHit("env-a", "i2", hit(), NOW + 2 * MIN);
    expect(await sendFixNotes(NOW + 3 * MIN, deps)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("holds for a paused session or one waiting on a person, then sends", async () => {
    seedSession("env-p", { pause_state: "paused" });
    seedSession("env-w");
    recordHit("env-p", "i1", hit(), NOW);
    recordHit("env-w", "i1", hit(), NOW);
    const waiting = new Set(["env-w"]);
    const { send, deps } = noteDeps({ blocked: (id) => waiting.has(id) });
    expect(await sendFixNotes(NOW + MIN, deps)).toBe(0);
    expect(send).not.toHaveBeenCalled();
    waiting.clear();
    db.prepare(`DELETE FROM session_pauses WHERE session_id = 'env-p'`).run();
    expect(await sendFixNotes(NOW + 2 * MIN, deps)).toBe(2);
  });

  it("does not claim a send that was held", async () => {
    seedSession("env-w");
    recordHit("env-w", "i1", hit(), NOW);
    await sendFixNotes(NOW, noteDeps({ blocked: () => true }).deps);
    expect(rows()[0].nudged_at).toBeNull();
    expect(rows()[0].nudge_skipped).toBeNull();
  });

  it("skips a class with no fix, a stale hit and a finished session", async () => {
    seedSession("env-a");
    seedSession("env-b");
    seedSession("env-c", { task_status: "merged" });
    recordHit("env-a", "i1", hit("local-permission"), NOW);
    recordHit("env-b", "i1", hit(), NOW);
    recordHit("env-c", "i1", hit(), NOW + STALE_MS);
    const { send, deps } = noteDeps();
    await sendFixNotes(NOW + STALE_MS + MIN, deps);
    expect(send).not.toHaveBeenCalled();
    expect(rows().map((r) => r.nudge_skipped)).toEqual([
      "no fix",
      "stale",
      "gone",
    ]);
  });

  it("does not resend when the send fails", async () => {
    seedSession("env-a");
    recordHit("env-a", "i1", hit(), NOW);
    const send = vi.fn().mockRejectedValue(new Error("down"));
    const deps = { send, blocked: () => false };
    await sendFixNotes(NOW, deps);
    await sendFixNotes(NOW + MIN, deps);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends this machine's own text in place of the default", async () => {
    setFix("python-missing-module", "Run apps/x/fix first.");
    expect(fixFor("python-missing-module")).toBe("Run apps/x/fix first.");
    seedSession("env-a");
    recordHit("env-a", "i1", hit(), NOW);
    const { send, deps } = noteDeps();
    await sendFixNotes(NOW, deps);
    expect(send.mock.calls[0][1]).toContain("Run apps/x/fix first.");
    expect(setFix("nope", "x")).toBe(false);
  });
});

function alertDeps() {
  const queued: { ws: string; key: string; line: string }[] = [];
  const deps: AlertDeps = {
    queue: ((ws: string, key: string, _s: string | null, line: string) => {
      queued.push({ ws, key, line });
      return true;
    }) as AlertDeps["queue"],
    workspaces: () => ["w1", "w2"],
  };
  return { queued, deps };
}
const cfg = (): HealthConfig => ({ ...HEALTH_DEFAULTS });

describe("telling the orchestrator", () => {
  it("raises one burst when three sessions hit a class in 24h, and not a fourth", () => {
    const { queued, deps } = alertDeps();
    for (const [i, id] of ["env-a", "env-b", "env-c", "env-d"].entries()) {
      seedSession(id);
      recordHit(id, "i", hit(), NOW + i * HOUR);
      raiseAlerts(NOW + i * HOUR, cfg(), deps);
    }
    const kinds = rows().map((r) => r.alerted);
    expect(kinds.filter((k) => k === "burst")).toHaveLength(1);
    expect(kinds[0]).toBe("recur");
    expect(kinds[3]).toBeNull();
    expect(queued.filter((q) => q.key.includes(":burst:"))).toHaveLength(2);
    expect(queued.every((q) => q.line.includes("<untrusted"))).toBe(true);
  });

  it("does not burst for sessions spread over more than the window", () => {
    const { queued, deps } = alertDeps();
    for (const [i, id] of ["env-a", "env-b", "env-c"].entries()) {
      seedSession(id);
      recordHit(id, "i", hit(), NOW + i * 13 * HOUR);
      raiseAlerts(NOW + i * 13 * HOUR, cfg(), deps);
    }
    expect(queued.some((q) => q.key.includes(":burst:"))).toBe(false);
  });

  it("says when a class is back after a quiet spell, not when it is just ongoing", () => {
    const { queued, deps } = alertDeps();
    seedSession("env-a");
    recordHit("env-a", "i", hit(), NOW);
    raiseAlerts(NOW, cfg(), deps);
    seedSession("env-b");
    recordHit("env-b", "i", hit(), NOW + DAY);
    raiseAlerts(NOW + DAY, cfg(), deps);
    const keys = () => [...new Set(queued.map((q) => q.key))];
    expect(keys()).toHaveLength(1);
    expect(keys()[0]).toContain(":recur:");
    seedSession("env-c");
    recordHit("env-c", "i", hit(), NOW + 9 * DAY);
    raiseAlerts(NOW + 9 * DAY, cfg(), deps);
    expect(keys()).toHaveLength(2);
    expect(keys()[1]).toContain(":recur:");
  });

  it("goes to the session's workspace, or every orchestrator when it has none", () => {
    const { queued, deps } = alertDeps();
    seedSession("env-a");
    recordHit("env-a", "i", hit(), NOW);
    raiseAlerts(NOW, cfg(), deps);
    expect(queued.map((q) => q.ws)).toEqual(["w1", "w2"]);
  });
});

describe("the view", () => {
  it("counts sessions per class over 7 and 30 days and lists them", () => {
    seedSession("env-a");
    seedSession("env-b");
    recordHit("env-a", "i", hit(), NOW - 2 * DAY);
    recordHit("env-b", "i", hit(), NOW - 20 * DAY);
    const c = envSummary(NOW).classes.find(
      (k) => k.id === "python-missing-module"
    );
    expect([c?.sessions7, c?.sessions30]).toEqual([1, 2]);
    const list = envSessions("python-missing-module", 30, NOW);
    expect(list.map((s) => s.sessionId)).toEqual(["env-a", "env-b"]);
    expect(list[0].fix).toBe("waiting to send");
  });
});
