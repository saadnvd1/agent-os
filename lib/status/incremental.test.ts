import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";
import type { ChatItem } from "@/lib/chat/events";

let cached: TaskPR | null | undefined;
const prLookups: string[] = [];
vi.mock("@/lib/tasks/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/session")>()),
  cachedPR: (id: string) => {
    prLookups.push(id);
    return cached;
  },
}));
vi.mock("@/lib/status-detector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/status-detector")>()),
  statusDetector: {
    listSessions: async () => [],
    cleanup: () => {},
    hostErrors: () => ({}),
  },
}));

const { getDb, updateSessionRow } = await import("@/lib/db");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { putCheck } = await import("@/lib/orchestrator/checks");
const { saveItem } = await import("@/lib/chat/store");
const { emit } = await import("@/lib/chat/registry");
const { collectStatuses } = await import("./collect");
const { FULL_RECOMPUTE_MS, resetStatusCaches } = await import("./incremental");
const { markStatusDirty, markAllStatusDirty, takeDirty } =
  await import("./dirty");

const N = 20;
const db = getDb();
let ids: string[] = [];
let taskIds: string[] = [];
let workspaceId = "";
let clock = 0;

const open = (over: Partial<TaskPR> = {}): TaskPR => ({
  number: 7,
  url: "https://example.test/pull/7",
  state: "OPEN",
  checks: "none",
  head: "abcdef1234567",
  mergeable: "MERGEABLE",
  ...over,
});
const turnEnd = (id: string): ChatItem => ({
  id,
  kind: "turn_end",
  createdAt: Date.now(),
});
const userItem = (id: string, text: string): ChatItem => ({
  id,
  kind: "user",
  text,
  createdAt: Date.now(),
});
// A write nothing is told about.
const rawItem = (sessionId: string, item: ChatItem) =>
  db
    .prepare(
      `INSERT INTO chat_items (session_id, item_id, seq, data)
       VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_items WHERE session_id = ?), ?)`
    )
    .run(sessionId, item.id, sessionId, JSON.stringify(item));

const queries: { sql: string; args: unknown[] }[] = [];
function recordQueries() {
  const prepare = db.prepare.bind(db);
  return vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
    const stmt = prepare(sql);
    return new Proxy(stmt, {
      get(target, prop) {
        const value = (target as never)[prop];
        if (prop === "get" || prop === "all" || prop === "run")
          return (...args: unknown[]) => {
            queries.push({ sql, args });
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }) as never);
}
const queriesAbout = (id: string) => queries.filter((q) => q.args.includes(id));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = Date.parse("2026-06-01T12:00:00Z");
  vi.setSystemTime(clock);
  cached = undefined;
  prLookups.length = 0;
  queries.length = 0;
  db.exec(
    `DELETE FROM chat_items; DELETE FROM sessions; DELETE FROM orchestrator_checks`
  );
  const seeded = seedWorkspace();
  workspaceId = seeded.workspace.id;
  ids = Array.from({ length: N }, (_, n) =>
    seedSession({ projectId: seeded.app.id, name: `c${n}`, view: "chat" })
  );
  taskIds = [0, 1].map((n) => {
    const id = seedSession({
      projectId: seeded.app.id,
      name: `t${n}`,
      view: "chat",
      task: true,
    });
    updateSessionRow(db, id, { pr_number: 7, pr_status: "open" });
    return id;
  });
  resetStatusCaches();
  await collectStatuses();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const advance = (ms: number) => {
  clock += ms;
  vi.setSystemTime(clock);
};

describe("incremental status passes", () => {
  it("runs queries only for the session that changed", async () => {
    const spy = recordQueries();
    saveItem(ids[3], userItem("user-1", "ship it"));
    saveItem(ids[3], turnEnd("end-1"));
    queries.length = 0;
    const { statuses } = await collectStatuses();
    spy.mockRestore();

    expect(statuses[ids[3]]).toMatchObject({ unread: true, task: "ship it" });
    const others = [...ids, ...taskIds].filter((id) => id !== ids[3]);
    for (const id of others) expect(queriesAbout(id)).toEqual([]);
    expect(queriesAbout(ids[3]).length).toBeGreaterThan(0);
    // No session list was read: nothing moved the tables it comes from.
    expect(queries.some((q) => /FROM sessions s/.test(q.sql))).toBe(false);
  });

  it("runs nothing per session when nothing changed", async () => {
    const spy = recordQueries();
    await collectStatuses();
    spy.mockRestore();
    for (const id of [...ids, ...taskIds]) expect(queriesAbout(id)).toEqual([]);
  });

  it("shows a change in the next pass", async () => {
    expect((await collectStatuses()).statuses[ids[0]].unread).toBe(false);
    saveItem(ids[0], turnEnd("end-1"));
    expect((await collectStatuses()).statuses[ids[0]].unread).toBe(true);
    saveItem(ids[0], userItem("user-2", "next thing"));
    expect((await collectStatuses()).statuses[ids[0]].task).toBe("next thing");
  });

  it("sees row changes made with no hook, and sessions coming and going", async () => {
    saveItem(ids[1], turnEnd("end-1"));
    expect((await collectStatuses()).statuses[ids[1]].unread).toBe(true);
    db.prepare(
      `UPDATE sessions SET last_seen_at = datetime('now', '+1 hour') WHERE id = ?`
    ).run(ids[1]);
    expect((await collectStatuses()).statuses[ids[1]].unread).toBe(false);
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(ids[2]);
    expect((await collectStatuses()).statuses[ids[2]]).toBeUndefined();
    const fresh = seedSession({
      projectId: (
        db
          .prepare(`SELECT project_id FROM sessions WHERE id = ?`)
          .get(ids[0]) as { project_id: string }
      ).project_id,
      name: "new",
      view: "chat",
    });
    expect((await collectStatuses()).statuses[fresh]).toBeDefined();
  });

  it("keeps a worker's write that lands after its event in view", async () => {
    emit(ids[4], { type: "item", item: turnEnd("end-1") });
    // The event came first; the worker's write follows.
    expect((await collectStatuses()).statuses[ids[4]].unread).toBe(false);
    rawItem(ids[4], turnEnd("end-1"));
    expect((await collectStatuses()).statuses[ids[4]].unread).toBe(true);
    // Past the window the entry is settled: a write nobody told us of waits
    // for the full pass.
    advance(600);
    await collectStatuses();
    rawItem(ids[4], userItem("user-9", "late"));
    expect((await collectStatuses()).statuses[ids[4]].task).toBeNull();
  });

  it("corrects a stale entry on the periodic full pass", async () => {
    rawItem(ids[5], turnEnd("end-1"));
    expect((await collectStatuses()).statuses[ids[5]].unread).toBe(false);
    advance(FULL_RECOMPUTE_MS + 1);
    expect((await collectStatuses()).statuses[ids[5]].unread).toBe(true);
  });

  it("gives what a full pass gives, after a mix of changes", async () => {
    saveItem(ids[0], userItem("user-1", "a"));
    saveItem(ids[1], turnEnd("end-1"));
    cached = open();
    // What polling the PR does (lib/tasks/session.ts).
    for (const id of taskIds) markStatusDirty(id);
    putCheck({
      workspaceId,
      sessionId: taskIds[0],
      sha: "abcdef1234567",
      kind: "review",
      status: "running",
    });
    db.prepare(`UPDATE sessions SET name = 'renamed' WHERE id = ?`).run(ids[6]);
    const incremental = await collectStatuses();
    const full = await collectStatuses({ full: true });
    expect(incremental).toEqual(full);
  });

  it("recomputes only the task whose PR inputs changed", async () => {
    cached = open();
    await collectStatuses({ full: true });
    prLookups.length = 0;
    const stage = async (id: string) =>
      (await collectStatuses()).statuses[id].prStage?.stage;
    expect(await stage(taskIds[0])).toBe("open");
    prLookups.length = 0;
    putCheck({
      workspaceId,
      sessionId: taskIds[0],
      sha: "abcdef1234567",
      kind: "review",
      status: "running",
    });
    expect(await stage(taskIds[0])).toBe("review-running");
    expect(await stage(taskIds[1])).toBe("open");
    expect(prLookups).toEqual([taskIds[0]]);
  });
});

describe("dirty marks", () => {
  it("keep a session marked until a pass after its settle time", () => {
    takeDirty();
    markStatusDirty("a", 500);
    markStatusDirty("b");
    const now = Date.now();
    expect([...takeDirty(now).ids].sort()).toEqual(["a", "b"]);
    expect([...takeDirty(now + 100).ids]).toEqual(["a"]);
    expect([...takeDirty(now + 500).ids]).toEqual(["a"]);
    expect([...takeDirty(now + 501).ids]).toEqual([]);
  });

  it("say once that everything changed", () => {
    takeDirty();
    markAllStatusDirty();
    expect(takeDirty().all).toBe(true);
    expect(takeDirty().all).toBe(false);
  });
});
