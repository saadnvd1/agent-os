import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db/types";
import type { TaskState } from "@/lib/tasks/state";
import {
  buildShelves,
  orderGroups,
  sameRow,
  type RowStatus,
  type SessionGroup,
  type ShelfInput,
} from "./shelves";
import { shownShelves, visibleSessionIds } from "./visible-order";
import { rollups } from "./rollup";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86400_000;
const utc = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const fresh = utc(NOW - 3600_000);
const stale = utc(NOW - 5 * DAY);

const group = (id: string, over: Partial<SessionGroup> = {}): SessionGroup => ({
  id,
  workspace_id: "w1",
  name: id.toUpperCase(),
  sort_order: 0,
  collapsed: false,
  created_at: "2026-10-01 00:00:00",
  updated_at: "2026-10-01 00:00:00",
  ...over,
});

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    project_id: "p1",
    updated_at: fresh,
    created_at: "2026-10-01 12:00:00",
    archived_at: null,
    pinned: false,
    role: null,
    workspace_id: null,
    conductor_session_id: null,
    worker_status: null,
    session_group_id: null,
    ...over,
  } as Session;
}

function build(
  sessions: Session[],
  groups: SessionGroup[],
  statuses: Record<string, RowStatus> = {},
  extra: Partial<ShelfInput> = {}
) {
  const out = buildShelves({
    sessions,
    statuses,
    tasks: {},
    projectName: () => "agent-os",
    groups,
    now: NOW,
    ...extra,
  });
  const ids = (rows: { session: Session }[]) => rows.map((r) => r.session.id);
  return {
    raw: out,
    group: (id: string) =>
      ids(out.groups.find((g) => g.group.id === id)?.rows ?? []),
    groupIds: out.groups.map((g) => g.group.id),
    needsYou: ids(out.needsYou),
    working: ids(out.working),
    ongoing: ids(out.ongoing),
    snoozed: ids(out.snoozed),
    done: ids(out.done),
    pinned: ids(out.pinned),
  };
}

const L = group("l");

describe("group shelves", () => {
  it("keep a member on its group whatever its status", () => {
    const sessions = [
      session("needs", { session_group_id: "l" }),
      session("works", { session_group_id: "l" }),
      session("quiet", { session_group_id: "l" }),
      session("review", { session_group_id: "l", task_status: "running" }),
      session("asleep", {
        session_group_id: "l",
        snoozed_until: utc(NOW + DAY),
        snoozed_at: fresh,
      }),
      session("free"),
    ];
    const out = build(
      sessions,
      [L],
      {
        needs: { need: "approve", status: "waiting" },
        works: { status: "running" },
      },
      { tasks: { review: "review" as TaskState } }
    );
    expect(out.group("l").sort()).toEqual([
      "asleep",
      "needs",
      "quiet",
      "review",
      "works",
    ]);
    expect(out.ongoing).toEqual(["free"]);
    expect(out.needsYou).toEqual([]);
  });

  it("count what needs you for a folded header", () => {
    const out = build(
      [
        session("a", { session_group_id: "l" }),
        session("b", { session_group_id: "l" }),
        session("c", { session_group_id: "l" }),
      ],
      [L],
      { a: { need: "answer", status: "waiting" }, b: { need: "failed" } }
    );
    expect(out.raw.groups[0].rollup).toEqual({ needsYou: 2 });
  });

  it("send finished work to Done but remember the group", () => {
    const merged = session("merged", {
      session_group_id: "l",
      task_status: "merged",
    });
    const byHand = session("hand", {
      session_group_id: "l",
      settled_at: utc(NOW - DAY),
      updated_at: stale,
      active_at: stale,
    });
    const out = build(
      [merged, byHand],
      [L],
      {},
      { tasks: { merged: "merged" } }
    );
    expect(out.group("l")).toEqual([]);
    expect(out.done.sort()).toEqual(["hand", "merged"]);
    for (const r of out.raw.done) expect(r.groupName).toBe("L");
  });

  it("let a quiet session settle in place, muted", () => {
    const out = build(
      [
        session("old", {
          session_group_id: "l",
          updated_at: stale,
          active_at: stale,
        }),
      ],
      [L]
    );
    expect(out.group("l")).toEqual(["old"]);
    expect(out.raw.groups[0].rows[0].settled).toBe("auto");
    expect(out.done).toEqual([]);
  });

  it("a live need beats a manual Done", () => {
    const s = session("s", {
      session_group_id: "l",
      settled_at: utc(NOW - DAY),
      updated_at: stale,
      active_at: stale,
    });
    const out = build([s], [L], { s: { need: "approve", status: "waiting" } });
    expect(out.group("l")).toEqual(["s"]);
  });

  it("put Pinned ahead of a group", () => {
    const out = build(
      [session("p", { session_group_id: "l", pinned: true })],
      [L]
    );
    expect(out.pinned).toEqual(["p"]);
    expect(out.group("l")).toEqual([]);
  });

  it("treat a deleted or unknown group as no group", () => {
    const out = build([session("x", { session_group_id: "gone" })], [L]);
    expect(out.ongoing).toEqual(["x"]);
    expect(out.group("l")).toEqual([]);
  });

  it("show an empty group, unless a filter is on", () => {
    expect(build([], [L]).groupIds).toEqual(["l"]);
    expect(build([], [L], {}, { query: "zzz" }).groupIds).toEqual([]);
    expect(build([], [L], {}, { projectId: "p1" }).groupIds).toEqual([]);
    const match = build(
      [session("zzz", { session_group_id: "l" })],
      [L],
      {},
      { query: "zzz" }
    );
    expect(match.groupIds).toEqual(["l"]);
  });

  it("order members newest activity first", () => {
    const out = build(
      [
        session("old", {
          session_group_id: "l",
          active_at: utc(NOW - 2 * DAY),
          updated_at: utc(NOW - 2 * DAY),
        }),
        session("new", {
          session_group_id: "l",
          active_at: utc(NOW - 3600_000),
          updated_at: utc(NOW - 3600_000),
        }),
      ],
      [L]
    );
    expect(out.group("l")).toEqual(["new", "old"]);
  });

  it("nest workers under their conductor, but a worker that needs you shows in its own group", () => {
    const conductor = session("c", { session_group_id: "l" });
    const calm = session("w1", {
      conductor_session_id: "c",
      session_group_id: "l",
    });
    const blocked = session("w2", {
      conductor_session_id: "c",
      session_group_id: "l",
    });
    const out = build([conductor, calm, blocked], [L], {
      w2: { need: "answer", status: "waiting" },
    });
    expect(out.group("l").sort()).toEqual(["c", "w2"]);
    expect(
      out.raw.groups[0].rows
        .find((r) => r.session.id === "c")
        ?.workers.map((w) => w.session.id)
    ).toEqual(["w1"]);
  });
});

describe("group order and visibility", () => {
  it("orders by workspace, then the group's own order", () => {
    const gs = [
      group("b", { workspace_id: "w2", sort_order: 0 }),
      group("n", { workspace_id: null, sort_order: 0 }),
      group("a2", { workspace_id: "w1", sort_order: 1 }),
      group("a1", { workspace_id: "w1", sort_order: 0 }),
    ];
    expect(orderGroups(gs, ["w1", "w2"]).map((g) => g.id)).toEqual([
      "a1",
      "a2",
      "b",
      "n",
    ]);
  });

  it("lists a folded group's rows nowhere in the visible order", () => {
    const rows = [session("in", { session_group_id: "l" }), session("out")];
    const open = build(rows, [L]).raw;
    const folded = build(rows, [{ ...L, collapsed: true }]).raw;
    const folds = { doneCollapsed: true, snoozedCollapsed: true, donePages: 0 };
    expect(visibleSessionIds(open, [], folds)).toEqual(["in", "out"]);
    expect(visibleSessionIds(folded, [], folds)).toEqual(["out"]);
    expect(shownShelves(folded, folds).groups[0].rows).toEqual([]);
  });

  it("counts group rows in an orchestrator's rollup", () => {
    const s = session("w", { session_group_id: "l", started_by: "orch" });
    const out = build([s], [L], { w: { status: "running" } }).raw;
    expect(rollups(out, []).get("orch")?.running).toBe(1);
  });

  it("redraws a Done row whose group name changed", () => {
    const s = session("s", {
      session_group_id: "l",
      settled_at: utc(NOW - DAY),
      updated_at: utc(NOW - 3 * DAY),
      active_at: utc(NOW - 3 * DAY),
    });
    const a = build([s], [L]).raw.done[0];
    const b = build([s], [{ ...L, name: "Renamed" }]).raw.done[0];
    expect(sameRow(a, b)).toBe(false);
  });

  it("leaves the group's name off rows inside it", () => {
    const s = session("s", { session_group_id: "l" });
    expect(build([s], [L]).raw.groups[0].rows[0].groupName).toBeUndefined();
  });
});
