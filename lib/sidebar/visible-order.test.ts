import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db";
import { buildShelves } from "./shelves";
import {
  neighbourSession,
  shownShelves,
  visibleSessionIds,
  type ShelfFolds,
} from "./visible-order";

const NOW = Date.UTC(2026, 9, 10, 12);
const at = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    project_id: "p1",
    updated_at: at(NOW - 20 * 86400_000),
    created_at: at(NOW - 30 * 86400_000),
    active_at: at(NOW - 20 * 86400_000),
    archived_at: null,
    pinned: false,
    role: null,
    workspace_id: null,
    conductor_session_id: null,
    worker_status: null,
    ...over,
  } as Session;
}

const shelves = buildShelves({
  sessions: [
    session("done1"),
    session("run1"),
    session("pin1", { pinned: true }),
    session("run2"),
    session("cond"),
    session("worker", { conductor_session_id: "cond" }),
    session("done2"),
  ],
  statuses: { run1: { status: "running" }, run2: { status: "running" } },
  tasks: {},
  projectName: () => "agent-os",
  now: NOW,
});
const open: ShelfFolds = {
  doneCollapsed: false,
  snoozedCollapsed: false,
  donePages: 0,
};

describe("visibleSessionIds", () => {
  it("lists pinned, then working, then done, workers under their conductor", () => {
    const ids = visibleSessionIds(shelves, [], open);
    expect(ids.indexOf("pin1")).toBeLessThan(ids.indexOf("run1"));
    expect(ids.indexOf("run1")).toBeLessThan(ids.indexOf("done1"));
    expect(ids).toEqual(
      [
        ...shelves.pinned,
        ...shelves.needsYou,
        ...shelves.working,
        ...shelves.inReview,
        ...shelves.ongoing,
        ...shelves.snoozed,
        ...shelves.done,
      ].flatMap((r) => [r.session.id, ...r.workers.map((w) => w.session.id)])
    );
    expect(ids).toContain("worker");
  });

  it("leaves out a folded Done shelf and keeps the rest", () => {
    const ids = visibleSessionIds(shelves, [], {
      ...open,
      doneCollapsed: true,
    });
    expect(ids).not.toContain("done1");
    expect(ids).not.toContain("done2");
    expect(ids).toContain("pin1");
    expect(ids).toContain("run1");
  });

  it("counts only the Done rows a page shows", () => {
    const many = {
      ...shelves,
      done: Array.from({ length: 80 }, (_, i) => ({
        ...shelves.done[0],
        session: session(`d${i}`),
        workers: [],
      })),
    };
    expect(shownShelves(many, open).done.length).toBeLessThan(80);
    expect(visibleSessionIds(many, [], open)).toHaveLength(
      shownShelves(many, open).done.length +
        visibleSessionIds(shelves, [], { ...open, doneCollapsed: true }).length
    );
  });
});

describe("neighbourSession", () => {
  const ids = ["a", "b", "c"];
  it("steps up and down", () => {
    expect(neighbourSession(ids, "b", 1)).toBe("c");
    expect(neighbourSession(ids, "b", -1)).toBe("a");
  });
  it("does not wrap at either end", () => {
    expect(neighbourSession(ids, "c", 1)).toBeNull();
    expect(neighbourSession(ids, "a", -1)).toBeNull();
  });
  it("starts at an end when nothing in the list is active", () => {
    expect(neighbourSession(ids, undefined, 1)).toBe("a");
    expect(neighbourSession(ids, "gone", -1)).toBe("c");
    expect(neighbourSession([], "a", 1)).toBeNull();
  });
});
