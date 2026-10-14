import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db/types";
import type { QueuedTaskView } from "@/lib/tasks/queue";
import type { TaskState } from "@/lib/tasks/state";
import { queuedRows } from "./queued";
import { rollups, visibleChips } from "./rollup";
import {
  buildShelves,
  doneSummary,
  type RowStatus,
  type SidebarRow,
} from "./shelves";

const session = (id: string, over: Partial<Session> = {}): Session =>
  ({
    id,
    name: id,
    project_id: "p1",
    updated_at: "2026-10-11 12:00:00",
    created_at: "2026-10-01 12:00:00",
    archived_at: null,
    pinned: false,
    role: null,
    workspace_id: null,
    conductor_session_id: null,
    worker_status: null,
    started_by: null,
    ...over,
  }) as Session;

const queueItem = (
  id: string,
  over: Partial<QueuedTaskView> = {}
): QueuedTaskView => ({
  id,
  name: id,
  prompt: "x",
  projectId: "p1",
  projectName: "A",
  workspaceId: "w1",
  status: "queued",
  position: 1,
  after: null,
  afterId: null,
  note: null,
  error: null,
  startedBy: null,
  priority: "normal",
  wait: null,
  rank: 1,
  of: 1,
  held: 0,
  createdAt: "2026-10-11T00:00:00Z",
  ...over,
});

function build(
  sessions: Session[],
  statuses: Record<string, RowStatus> = {},
  tasks: Record<string, TaskState> = {},
  startedBy?: string
) {
  return buildShelves({
    sessions,
    statuses,
    tasks,
    projectName: () => "A",
    startedBy,
    now: Date.parse("2026-10-11T13:00:00Z"),
  });
}

const noQueue: { item: QueuedTaskView }[] = [];

describe("rollups", () => {
  const sessions = [
    session("run1", { started_by: "o1" }),
    session("run2", { started_by: "o1" }),
    session("rev", { started_by: "o1" }),
    session("blk", { started_by: "o1" }),
    session("idle", { started_by: "o1" }),
    session("other", { started_by: "o2" }),
    session("mine"),
  ];
  const statuses = {
    run1: { status: "running" },
    run2: { status: "running" },
    rev: { status: "idle" },
    blk: { status: "waiting", need: "approve" as const },
    other: { status: "running" },
  };
  const tasks = { rev: "review" as const };

  it("counts running, in review and blocked from the rows the shelves hold", () => {
    const r = rollups(build(sessions, statuses, tasks), noQueue).get("o1");
    expect(r).toEqual({ running: 2, inReview: 1, blocked: 1, queued: 0 });
  });

  it("keeps each orchestrator's work apart and ignores sessions nobody started", () => {
    const all = rollups(build(sessions, statuses, tasks), noQueue);
    expect(all.get("o2")).toMatchObject({ running: 1 });
    expect(all.has("o1")).toBe(true);
    expect([...all.keys()].sort()).toEqual(["o1", "o2"]);
  });

  it("counts a worker that needs you as blocked, not in review", () => {
    const r = rollups(
      build(
        [session("w", { started_by: "o1" })],
        { w: { status: "idle" } },
        { w: "checks-failing" }
      ),
      noQueue
    ).get("o1");
    expect(r).toEqual({ running: 0, inReview: 0, blocked: 1, queued: 0 });
  });

  it("counts queued items from task_queue by started_by", () => {
    const queue = queuedRows({
      queue: [
        queueItem("q1", { startedBy: "o1" }),
        queueItem("q2", { startedBy: "o1", status: "starting" }),
        queueItem("q3", { startedBy: "o1", status: "failed" }),
        queueItem("q4", { startedBy: "o2" }),
        queueItem("q5"),
      ],
      sessionIds: new Set(),
      workspaceId: null,
    });
    const r = rollups(build([], {}), queue);
    expect(r.get("o1")?.queued).toBe(2);
    expect(r.get("o2")?.queued).toBe(1);
  });

  it("counts nested workers and quick changes too", () => {
    const shelves = build(
      [
        session("c", { started_by: "o1" }),
        session("w", { started_by: "o1", conductor_session_id: "c" }),
      ],
      { w: { status: "running" } }
    );
    expect(shelves.ongoing[0].workers).toHaveLength(1);
    expect(rollups(shelves, noQueue).get("o1")?.running).toBe(1);
  });

  it("hides zero chips", () => {
    expect(visibleChips(undefined)).toEqual([]);
    expect(
      visibleChips({ running: 2, inReview: 0, blocked: 0, queued: 1 }).map(
        (c) => c.key
      )
    ).toEqual(["running", "queued"]);
    expect(
      visibleChips({ running: 0, inReview: 0, blocked: 0, queued: 0 })
    ).toEqual([]);
  });
});

describe("orchestrator filter", () => {
  const sessions = [
    session("a", { started_by: "o1" }),
    session("b", { started_by: "o2" }),
    session("c"),
    session("o1", { role: "orchestrator" }),
  ];

  it("keeps only the sessions that orchestrator started, on the same shelves", () => {
    const s = build(sessions, { a: { status: "running" } }, {}, "o1");
    expect(s.working.map((r) => r.session.id)).toEqual(["a"]);
    expect(s.done).toEqual([]);
    expect(s.pinned).toEqual([]);
  });

  it("shows everything with no filter", () => {
    const s = build(sessions);
    expect(s.ongoing).toHaveLength(4);
  });

  it("filters the queued shelf the same way", () => {
    const rows = queuedRows({
      queue: [queueItem("q1", { startedBy: "o1" }), queueItem("q2")],
      sessionIds: new Set(),
      workspaceId: null,
      startedBy: "o1",
    });
    expect(rows.map((r) => r.item.id)).toEqual(["q1"]);
  });
});

describe("doneSummary", () => {
  const now = new Date(2026, 9, 11, 15, 0, 0);
  const at = (d: Date) => d.toISOString();
  const row = (id: string, updated: Date) =>
    ({ session: session(id, { updated_at: at(updated) }) }) as SidebarRow;

  it("counts today's and earlier ones", () => {
    const done = [
      row("a", new Date(2026, 9, 11, 9)),
      row("b", new Date(2026, 9, 11, 1)),
      row("c", new Date(2026, 9, 9, 9)),
    ];
    expect(doneSummary(done, now)).toEqual({
      today: 2,
      earlier: 1,
      text: "2 done today · 1 earlier",
    });
  });

  it("leaves out a part with nothing in it", () => {
    expect(doneSummary([row("a", new Date(2026, 9, 11, 9))], now).text).toBe(
      "1 done today"
    );
    expect(doneSummary([row("a", new Date(2026, 8, 1))], now).text).toBe(
      "1 earlier"
    );
    expect(doneSummary([], now).text).toBe("");
  });
});
