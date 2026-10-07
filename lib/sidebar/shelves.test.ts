import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db/types";
import {
  buildShelves,
  doneLimit,
  inWorkspace,
  needOf,
  taskNeed,
  type RowStatus,
  type ShelfInput,
} from "./shelves";

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
    ...extra,
  });
  const ids = (rows: { session: Session }[]) => rows.map((r) => r.session.id);
  return {
    pinned: ids(out.pinned),
    needsYou: ids(out.needsYou),
    working: ids(out.working),
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
