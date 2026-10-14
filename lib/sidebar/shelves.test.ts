import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db/types";
import type { TaskState } from "@/lib/tasks/state";
import {
  buildShelves,
  doneLimit,
  inWorkspace,
  needOf,
  sameRow,
  taskNeed,
  type RowStatus,
  type ShelfInput,
} from "./shelves";

// Two weeks after the fixtures' activity: plain idle sessions have settled.
const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86400_000;
const utc = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    project_id: "p1",
    updated_at: "2026-10-06 12:00:00",
    created_at: "2026-10-01 12:00:00",
    archived_at: null,
    pinned: false,
    role: null,
    workspace_id: null,
    conductor_session_id: null,
    worker_status: null,
    ...over,
  } as Session;
}

function shelves(
  sessions: Session[],
  statuses: Record<string, RowStatus> = {},
  extra: Partial<ShelfInput> = {}
) {
  const out = buildShelves({
    sessions,
    statuses,
    tasks: {},
    projectName: (s) => (s.project_id === "p1" ? "agent-os" : "poise"),
    now: NOW,
    ...extra,
  });
  const ids = (rows: { session: Session }[]) => rows.map((r) => r.session.id);
  return {
    orchestrators: ids(out.orchestrators),
    pinned: ids(out.pinned),
    needsYou: ids(out.needsYou),
    working: ids(out.working),
    inReview: ids(out.inReview),
    ongoing: ids(out.ongoing),
    snoozed: ids(out.snoozed),
    done: ids(out.done),
    raw: out,
  };
}

describe("needOf", () => {
  it("prefers an approval or a question over the task's state", () => {
    expect(needOf(session("a"), { need: "approve" }, "checks-failing")).toBe(
      "approve"
    );
    expect(needOf(session("a"), { need: "answer" }, "exited")).toBe("answer");
  });

  it("lets a failed or blocked task beat a terminal waiting for input", () => {
    expect(needOf(session("a"), { need: "input" }, "checks-failing")).toBe(
      "failed"
    );
    expect(needOf(session("a"), { need: "input" }, "blocked")).toBe("answer");
    expect(needOf(session("a"), { need: "input" }, "working")).toBe("input");
  });

  it("counts a failed worker and nothing for a quiet session", () => {
    expect(
      needOf(session("a", { worker_status: "failed" }), {}, undefined)
    ).toBe("failed");
    expect(needOf(session("a"), { status: "idle" }, "review")).toBeNull();
  });

  it("never lets a finished task need you over text left in a stopped agent", () => {
    for (const task of ["merged", "done", "dropped"] as const) {
      expect(needOf(session("a"), { need: "unsent" }, task)).toBeNull();
      expect(needOf(session("a"), { need: "input" }, task)).toBeNull();
    }
    expect(needOf(session("a"), { need: "unsent" }, "review")).toBe("unsent");
  });

  it("maps task states", () => {
    expect(taskNeed("exited")).toBe("failed");
    expect(taskNeed("merged")).toBeNull();
    expect(taskNeed(undefined)).toBeNull();
  });
});

describe("buildShelves", () => {
  it("puts each session on exactly one shelf, pinned first", () => {
    const out = shelves(
      [
        session("pin", { pinned: true }),
        session("pinWaiting", { pinned: true }),
        session("ask"),
        session("run"),
        session("old"),
      ],
      {
        pinWaiting: { need: "approve" },
        ask: { need: "answer" },
        run: { status: "running" },
        old: { status: "idle" },
      }
    );
    expect(out.pinned).toEqual(["pin", "pinWaiting"]);
    expect(out.needsYou).toEqual(["ask"]);
    expect(out.working).toEqual(["run"]);
    expect(out.done).toEqual(["old"]);
  });

  it("sorts Done newest first and pins oldest first", () => {
    const out = shelves([
      session("a", { updated_at: "2026-10-01 10:00:00" }),
      session("b", { updated_at: "2026-10-05 10:00:00" }),
      session("p2", { pinned: true, created_at: "2026-10-03 00:00:00" }),
      session("p1", { pinned: true, created_at: "2026-10-02 00:00:00" }),
    ]);
    expect(out.done).toEqual(["b", "a"]);
    expect(out.pinned).toEqual(["p1", "p2"]);
  });

  it("hides archived sessions", () => {
    const out = shelves([session("gone", { archived_at: "2026-10-06" })]);
    expect(out.done).toEqual([]);
  });

  it("nests workers under their conductor unless they need you", () => {
    const out = shelves(
      [
        session("conductor"),
        session("w1", { conductor_session_id: "conductor" }),
        session("w2", { conductor_session_id: "conductor" }),
        session("orphan", { conductor_session_id: "missing" }),
      ],
      { w2: { need: "approve" } }
    );
    expect(out.needsYou).toEqual(["w2"]);
    expect(out.done.sort()).toEqual(["conductor", "orphan"]);
    const conductor = out.raw.done.find((r) => r.session.id === "conductor");
    expect(conductor?.workers.map((w) => w.session.id)).toEqual(["w1"]);
  });

  it("filters by search over titles and project names, and by project", () => {
    const list = [
      session("Fix gate", { project_id: "p1" }),
      session("Budget", { project_id: "p2" }),
    ];
    expect(shelves(list, {}, { query: "gate" }).done).toEqual(["Fix gate"]);
    expect(shelves(list, {}, { query: "POISE" }).done).toEqual(["Budget"]);
    expect(shelves(list, {}, { projectId: "p1" }).done).toEqual(["Fix gate"]);
  });

  it("carries the unread flag", () => {
    const out = shelves([session("a")], { a: { unread: true } });
    expect(out.raw.done[0].unread).toBe(true);
  });
});

describe("finished vs open work", () => {
  const idle = { status: "idle" } as RowStatus;
  const place = (
    task: TaskState | undefined,
    status: RowStatus = idle,
    extra: Partial<Session> = {}
  ) => {
    const out = shelves(
      [session("t", extra)],
      { t: status },
      { tasks: task ? { t: task } : {} }
    );
    const at = (["pinned", "needsYou", "working", "inReview", "done"] as const)
      .filter((k) => out[k].length)
      .map(String);
    return at.length === 1 ? at[0] : at;
  };

  it("keeps a finished task with a stale unsent or queued message in Done", () => {
    for (const task of ["merged", "done", "dropped"] as const) {
      expect(place(task, { status: "waiting", need: "unsent" })).toBe("done");
      expect(place(task, { status: "waiting", need: "input" })).toBe("done");
    }
  });

  it("files a task with an open PR (in review, armed or not) under In review", () => {
    expect(place("review")).toBe("inReview");
  });

  it("files a task idle mid-job with no PR under Working", () => {
    expect(place("needs-input")).toBe("working");
    expect(place("working")).toBe("working");
    expect(place("moving")).toBe("working");
  });

  it("files a plan waiting for approval under In review", () => {
    expect(place("plan-ready")).toBe("inReview");
  });

  it("keeps merged, dropped and closed tasks, and idle plain sessions, in Done", () => {
    expect(place("merged")).toBe("done");
    expect(place("dropped")).toBe("done");
    expect(place("done")).toBe("done");
    expect(place(undefined)).toBe("done");
  });

  it("keeps Needs you and Working ahead of In review", () => {
    expect(place("review", { status: "running" })).toBe("working");
    expect(place("review", { need: "approve" })).toBe("needsYou");
    expect(place("checks-failing")).toBe("needsYou");
    expect(place("exited")).toBe("needsYou");
    expect(place("review", idle, { pinned: true })).toBe("pinned");
  });

  it("keeps an idle session with background work running under Working", () => {
    expect(place(undefined, { status: "idle", background: 1 })).toBe("working");
    expect(place("review", { status: "idle", background: 2 })).toBe("working");
    expect(place(undefined, { status: "idle", background: 0 })).toBe("done");
    expect(
      place(undefined, { status: "idle", background: 1, need: "approve" })
    ).toBe("needsYou");
  });

  it("keeps a recipe run that hasn't reported its result under Working", () => {
    const run = (status: string) => ({
      recipe_run: JSON.stringify({
        id: "r",
        name: "TestFlight build",
        seq: 2,
        status,
      }),
    });
    for (const open of ["queued", "starting", "running"])
      expect(place(undefined, idle, run(open))).toBe("working");
    for (const ended of ["succeeded", "failed", "cancelled", "timed_out"])
      expect(place(undefined, idle, run(ended))).toBe("done");
    expect(place(undefined, idle, { recipe_run: "not json" })).toBe("done");
    expect(place(undefined, { need: "approve" }, run("running"))).toBe(
      "needsYou"
    );
  });

  it("sorts In review newest first", () => {
    const out = shelves(
      [
        session("old", { updated_at: "2026-10-01 12:00:00" }),
        session("new", { updated_at: "2026-10-05 12:00:00" }),
      ],
      {},
      { tasks: { old: "review", new: "review" } }
    );
    expect(out.inReview).toEqual(["new", "old"]);
  });
});

describe("doneLimit", () => {
  it("shows 10, then 25 more per page", () => {
    expect(doneLimit(0)).toBe(10);
    expect(doneLimit(1)).toBe(35);
    expect(doneLimit(2)).toBe(60);
  });
});

describe("inWorkspace", () => {
  const workspaceOf = (id: string) => (id === "p1" ? "w1" : null);
  it("keeps everything with no workspace selected", () => {
    expect(
      inWorkspace(session("a", { project_id: "p2" }), workspaceOf, null)
    ).toBe(true);
  });
  it("scopes project sessions and orchestrators", () => {
    expect(inWorkspace(session("a"), workspaceOf, "w1")).toBe(true);
    expect(
      inWorkspace(session("a", { project_id: "p2" }), workspaceOf, "w1")
    ).toBe(false);
    const orch = session("o", {
      role: "orchestrator",
      workspace_id: "w1",
      project_id: null,
    });
    expect(inWorkspace(orch, workspaceOf, "w1")).toBe(true);
    expect(inWorkspace(orch, workspaceOf, "w2")).toBe(false);
  });
});

describe("sameRow", () => {
  const sessions = [
    session("a"),
    session("b"),
    session("w", { conductor_session_id: "a" }),
  ];
  const rowOf = (out: ReturnType<typeof shelves>, id: string) =>
    [
      ...out.raw.pinned,
      ...out.raw.needsYou,
      ...out.raw.working,
      ...out.raw.inReview,
      ...out.raw.done,
    ].find((r) => r.session.id === id)!;

  it("sees background work start and stop", () => {
    const at = (background?: number) =>
      rowOf(shelves(sessions, { a: { status: "idle", background } }), "a");
    expect(sameRow(at(), at(1))).toBe(false);
    expect(sameRow(at(), at(0))).toBe(true);
  });

  it("treats a rebuilt row with the same status as unchanged", () => {
    const before = shelves(sessions, { a: { status: "idle", detail: "x" } });
    const after = shelves(sessions, { a: { status: "idle", detail: "x" } });
    expect(sameRow(rowOf(before, "a"), rowOf(after, "a"))).toBe(true);
  });

  it("sees what a row draws change: status, detail, asks, a worker", () => {
    const base = shelves(sessions, { a: { status: "idle" } });
    const changes: Record<string, RowStatus>[] = [
      { a: { status: "running" } },
      { a: { status: "idle", detail: "building" } },
      { a: { status: "idle", asks: 2, need: "answer" as const } },
      { a: { status: "running", compacting: { since: 5 } } },
      { a: { status: "idle" }, w: { status: "running" } },
    ];
    for (const statuses of changes)
      expect(
        sameRow(rowOf(base, "a"), rowOf(shelves(sessions, statuses), "a"))
      ).toBe(false);
  });

  it("sees asks and unread change on their own", () => {
    const asking = shelves(sessions, {
      a: { status: "idle", need: "answer", asks: 1 },
    });
    const moreAsks = shelves(sessions, {
      a: { status: "idle", need: "answer", asks: 2 },
    });
    expect(sameRow(rowOf(asking, "a"), rowOf(moreAsks, "a"))).toBe(false);
    const read = shelves(sessions, { a: { status: "idle", unread: false } });
    const unread = shelves(sessions, { a: { status: "idle", unread: true } });
    expect(sameRow(rowOf(read, "a"), rowOf(unread, "a"))).toBe(false);
  });

  it("sees a renamed session", () => {
    const before = shelves(sessions);
    const after = shelves([
      session("a", { name: "renamed" }),
      ...sessions.slice(1),
    ]);
    expect(sameRow(rowOf(before, "a"), rowOf(after, "a"))).toBe(false);
  });
});

describe("the pinned orchestrator", () => {
  const orch = (id: string, over: Partial<Session> = {}) =>
    session(id, {
      role: "orchestrator",
      project_id: null,
      workspace_id: "w1",
      pinned: true,
      ...over,
    });

  it("puts only the current orchestrator on top; an old one is an ordinary row", () => {
    const out = shelves(
      [orch("current"), orch("old"), session("mine", { pinned: true })],
      { old: { status: "running" } },
      { currentOrchestrators: new Set(["current"]) }
    );
    expect(out.orchestrators).toEqual(["current"]);
    expect(out.pinned).toEqual(["mine"]);
    expect(out.working).toEqual(["old"]);
  });

  it("drops back among the sessions when unpinned, by its need", () => {
    const out = shelves(
      [orch("current", { pinned: false })],
      { current: { status: "waiting", need: "answer" } },
      { currentOrchestrators: new Set(["current"]) }
    );
    expect(out.orchestrators).toEqual([]);
    expect(out.needsYou).toEqual(["current"]);
  });

  it("carries its unread reply, and redraws when it's seen", () => {
    const current = new Set(["current"]);
    const unread = shelves(
      [orch("current")],
      { current: { status: "idle", unread: true } },
      { currentOrchestrators: current }
    ).raw.orchestrators[0];
    const read = shelves(
      [orch("current")],
      { current: { status: "idle", unread: false } },
      { currentOrchestrators: current }
    ).raw.orchestrators[0];
    expect(unread.unread).toBe(true);
    expect(read.unread).toBe(false);
    expect(sameRow(unread, read)).toBe(false);
  });

  it("is an ordinary row before the orchestrators have loaded", () => {
    expect(shelves([orch("current")]).orchestrators).toEqual([]);
  });
});

describe("a compacting chat", () => {
  it("is a working row that says it is compacting", () => {
    const out = shelves([session("a"), session("b")], {
      a: { status: "running", compacting: { since: 1, before: 150_000 } },
      b: { status: "running" },
    });
    const row = (id: string) =>
      out.raw.working.find((r) => r.session.id === id)!;
    expect(row("a")).toMatchObject({ working: true, compacting: true });
    expect(row("b")).toMatchObject({ working: true, compacting: false });
  });
});

describe("Ongoing, Snoozed and settled", () => {
  const ago = (ms: number) => utc(NOW - ms);
  const quiet = (id: string, ms: number, over: Partial<Session> = {}) =>
    session(id, { active_at: ago(ms), updated_at: ago(ms), ...over });

  it("a plain idle session is ongoing for three days, newest activity first", () => {
    const s = shelves([
      quiet("old", 2 * DAY + 23 * 3600_000),
      quiet("new", 3600_000),
      quiet("mid", DAY),
    ]);
    expect(s.ongoing).toEqual(["new", "mid", "old"]);
    expect(s.done).toEqual([]);
    expect(s.raw.ongoing[0].activeAt).toBe(NOW - 3600_000);
  });

  it("settles by itself after three days of quiet", () => {
    const s = shelves([quiet("a", 3 * DAY + 60_000)]);
    expect(s.done).toEqual(["a"]);
    expect(s.raw.done[0].settled).toBe("auto");
  });

  it("reads activity from active_at, not updated_at, and falls back to it", () => {
    const s = shelves([
      session("renamed", { active_at: ago(5 * DAY), updated_at: ago(60_000) }),
      session("legacy", { active_at: null, updated_at: ago(60_000) }),
    ]);
    expect(s.done).toEqual(["renamed"]);
    expect(s.ongoing).toEqual(["legacy"]);
  });

  it("Mark done puts it in Done until it does something", () => {
    const settled = quiet("a", DAY, { settled_at: ago(3600_000) });
    const s = shelves([
      settled,
      quiet("b", DAY, { settled_at: ago(3600_000), active_at: ago(60_000) }),
    ]);
    expect(s.done).toEqual(["a"]);
    expect(s.raw.done[0].settled).toBe("manual");
    expect(s.ongoing).toEqual(["b"]);
  });

  it("new activity brings an auto-settled session back", () => {
    const s = shelves([quiet("a", 10 * DAY, { active_at: ago(1000) })]);
    expect(s.ongoing).toEqual(["a"]);
  });

  it("never auto-settles pinned, running, background, needing or open-PR rows", () => {
    const old = (id: string, over: Partial<Session> = {}) =>
      quiet(id, 10 * DAY, over);
    const s = shelves(
      [
        old("pin", { pinned: true }),
        old("run"),
        old("bg"),
        old("need"),
        old("pr", { task_status: "running" }),
        old("idleTask", { task_status: "running" }),
        old("merged", { task_status: "merged" }),
      ],
      {
        run: { status: "running" },
        bg: { background: 2 },
        need: { need: "approve" },
      },
      {
        tasks: {
          pr: "review",
          idleTask: "working",
          merged: "merged",
        },
      }
    );
    expect(s.pinned).toEqual(["pin"]);
    expect(s.working.sort()).toEqual(["bg", "idleTask", "run"]);
    expect(s.needsYou).toEqual(["need"]);
    expect(s.inReview).toEqual(["pr"]);
    expect(s.done).toEqual(["merged"]);
    expect(s.ongoing).toEqual([]);
  });

  it("sorts finished tasks in Done by settled_at, else merged_at, else updated_at", () => {
    const task = (id: string, over: Partial<Session>) =>
      session(id, { task_status: "merged", ...over });
    const s = shelves(
      [
        task("updated", { updated_at: utc(NOW - 3 * DAY) }),
        task("merged", {
          updated_at: utc(NOW - 9 * DAY),
          merged_at: utc(NOW - 2 * DAY),
        }),
        task("settled", {
          updated_at: utc(NOW - 9 * DAY),
          merged_at: utc(NOW - 8 * DAY),
          settled_at: utc(NOW - DAY),
        }),
      ],
      {},
      { tasks: { updated: "merged", merged: "merged", settled: "merged" } }
    );
    expect(s.done).toEqual(["settled", "merged", "updated"]);
  });

  it("a settled session that needs you or runs is not in Done", () => {
    const s = shelves(
      [
        quiet("n", DAY, { settled_at: ago(1000) }),
        quiet("r", DAY, { settled_at: ago(1000) }),
      ],
      { n: { need: "answer" }, r: { status: "running" } }
    );
    expect(s.needsYou).toEqual(["n"]);
    expect(s.working).toEqual(["r"]);
  });

  describe("snoozed", () => {
    const snooze = (id: string, untilMs: number, over: Partial<Session> = {}) =>
      quiet(id, DAY, {
        snoozed_at: ago(3600_000),
        snoozed_until: utc(NOW + untilMs),
        ...over,
      });

    it("sits in Snoozed, soonest wake first, with its wake time", () => {
      const s = shelves([snooze("late", 3 * DAY), snooze("soon", 3600_000)]);
      expect(s.snoozed).toEqual(["soon", "late"]);
      expect(s.raw.snoozed[0].wakesAt).toBe(NOW + 3600_000);
      expect(s.ongoing).toEqual([]);
    });

    it("wakes early on any activity since", () => {
      const s = shelves(
        [
          snooze("replied", DAY, { active_at: ago(60_000) }),
          snooze("needs", DAY),
          snooze("runs", DAY),
          snooze("fails", DAY, { worker_status: "failed" }),
        ],
        {
          needs: { need: "approve" },
          runs: { status: "running" },
        }
      );
      expect(s.ongoing).toEqual(["replied"]);
      expect(s.needsYou.sort()).toEqual(["fails", "needs"]);
      expect(s.working).toEqual(["runs"]);
      expect(s.snoozed).toEqual([]);
    });

    it("wakes at its time into Ongoing, unread until opened", () => {
      const woke = snooze("a", -60_000, {
        active_at: ago(20 * DAY),
        updated_at: ago(20 * DAY),
      });
      let s = shelves([woke]);
      expect(s.ongoing).toEqual(["a"]);
      expect(s.raw.ongoing[0].unread).toBe(true);
      expect(s.raw.ongoing[0].activeAt).toBe(NOW - 60_000);

      s = shelves([{ ...woke, last_seen_at: utc(NOW - 1000) }]);
      expect(s.raw.ongoing[0].unread).toBe(false);
    });

    it("a woken session settles three days after the wake, not at once", () => {
      const woke = snooze("a", -2 * DAY, { active_at: ago(30 * DAY) });
      expect(shelves([woke]).ongoing).toEqual(["a"]);
      expect(shelves([woke], {}, { now: NOW + 2 * DAY }).done).toEqual(["a"]);
    });

    it("pinned stays pinned; a snoozed task leaves In review", () => {
      const s = shelves(
        [
          snooze("pin", DAY, { pinned: true }),
          snooze("pr", DAY, { task_status: "running" }),
        ],
        {},
        { tasks: { pr: "review" } }
      );
      expect(s.pinned).toEqual(["pin"]);
      expect(s.snoozed).toEqual(["pr"]);
    });

    it("a mirrored session goes by its machine's updated_at", () => {
      const s = shelves([
        session("m", {
          peer_mirror: 1,
          active_at: ago(10 * DAY),
          updated_at: ago(1000),
        }),
      ]);
      expect(s.ongoing).toEqual(["m"]);
    });
  });

  it("Done orders by when it was marked, and sameRow sees the new fields", () => {
    const s = shelves([
      quiet("a", 5 * DAY),
      quiet("b", DAY, { settled_at: ago(1000) }),
    ]);
    expect(s.done).toEqual(["b", "a"]);
    const [row] = s.raw.done;
    expect(sameRow(row, { ...row, activeAt: row.activeAt + 1 })).toBe(false);
    expect(sameRow(row, { ...row, wakesAt: 5 })).toBe(false);
    expect(sameRow(row, { ...row, settled: "auto" })).toBe(false);
  });
});
