import { describe, expect, it } from "vitest";
import type { QueuedTaskView } from "@/lib/tasks/queue";
import { queueMenu, queueRequest, queuedRows, queuedSubtitle } from "./queued";

const item = (
  id: string,
  over: Partial<QueuedTaskView> = {}
): QueuedTaskView => ({
  id,
  name: `Task ${id}`,
  prompt: "do it",
  projectId: "p1",
  projectName: "Alpha",
  workspaceId: "w1",
  status: "queued",
  position: 1,
  after: null,
  afterId: null,
  note: null,
  error: null,
  createdAt: "2026-10-10T00:00:00Z",
  ...over,
});

const NO_SESSIONS = new Set<string>();

describe("queuedRows", () => {
  const queue = [
    item("a", { position: 1 }),
    item("b", { position: 2, projectId: "p2", projectName: "Beta" }),
    item("c", { workspaceId: "w2", position: 1 }),
    item("d", { position: 3 }),
  ];

  it("keeps the current workspace's tasks in line order", () => {
    const rows = queuedRows({
      queue,
      sessionIds: NO_SESSIONS,
      workspaceId: "w1",
    });
    expect(rows.map((r) => r.item.id)).toEqual(["a", "b", "d"]);
  });

  it("shows every workspace's with none picked", () => {
    const rows = queuedRows({
      queue,
      sessionIds: NO_SESSIONS,
      workspaceId: null,
    });
    expect(rows.map((r) => r.item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("follows the project filter and the search", () => {
    expect(
      queuedRows({
        queue,
        sessionIds: NO_SESSIONS,
        workspaceId: "w1",
        projectId: "p2",
      }).map((r) => r.item.id)
    ).toEqual(["b"]);
    expect(
      queuedRows({
        queue,
        sessionIds: NO_SESSIONS,
        workspaceId: "w1",
        query: " beta ",
      }).map((r) => r.item.id)
    ).toEqual(["b"]);
    expect(
      queuedRows({
        queue,
        sessionIds: NO_SESSIONS,
        workspaceId: "w1",
        query: "task d",
      }).map((r) => r.item.id)
    ).toEqual(["d"]);
  });

  // The queued row's id is the session it starts as: once that session is
  // listed, its row takes over and the queued one goes, with no reload.
  it("drops a task that has become a session", () => {
    const rows = queuedRows({
      queue,
      sessionIds: new Set(["a"]),
      workspaceId: "w1",
    });
    expect(rows.map((r) => r.item.id)).toEqual(["b", "d"]);
  });

  it("links what it waits on only when that's a session here", () => {
    const waits = [
      item("x", { after: "Fix login", afterId: "s1" }),
      item("y", { after: "Task x", afterId: "x" }),
      item("z", { after: "any running task" }),
    ];
    const rows = queuedRows({
      queue: waits,
      sessionIds: new Set(["s1"]),
      workspaceId: "w1",
    });
    expect(rows.map((r) => r.afterSessionId)).toEqual(["s1", null, null]);
  });

  it("moves only within its own workspace's waiting line", () => {
    const line = [
      item("a"),
      item("f", { status: "failed" }),
      item("o", { workspaceId: "w2" }),
      item("b"),
      item("c", { status: "starting" }),
    ];
    const rows = queuedRows({
      queue: line,
      sessionIds: NO_SESSIONS,
      workspaceId: null,
    });
    const moves = Object.fromEntries(
      rows.map((r) => [r.item.id, [r.canMoveUp, r.canMoveDown]])
    );
    expect(moves).toEqual({
      a: [false, true],
      f: [false, false],
      o: [false, false],
      b: [true, false],
      c: [false, false],
    });
  });
});

describe("queuedRows without a workspace", () => {
  it("keeps each project's line apart", () => {
    const rows = queuedRows({
      queue: [
        item("a", { workspaceId: null, projectId: "p1" }),
        item("b", { workspaceId: null, projectId: "p2" }),
        item("c", { workspaceId: null, projectId: "p1" }),
      ],
      sessionIds: NO_SESSIONS,
      workspaceId: null,
    });
    expect(
      Object.fromEntries(
        rows.map((r) => [r.item.id, [r.canMoveUp, r.canMoveDown]])
      )
    ).toEqual({ a: [false, true], b: [false, false], c: [true, false] });
  });
});

describe("queuedSubtitle", () => {
  it("says its place, its wait, a hold, or what went wrong", () => {
    expect(queuedSubtitle(item("a", { position: 2 }))).toEqual({
      lead: "#2 in line",
      after: null,
    });
    expect(queuedSubtitle(item("a", { after: "Fix login" }))).toEqual({
      lead: "After",
      after: "Fix login",
    });
    expect(
      queuedSubtitle(
        item("a", { note: "Waiting: the orchestrator is paused", after: "X" })
      ).lead
    ).toBe("Waiting: the orchestrator is paused");
    expect(queuedSubtitle(item("a", { status: "starting" })).lead).toBe(
      "Starting"
    );
    expect(
      queuedSubtitle(
        item("a", { status: "failed", error: "Could not start: no repo" })
      ).lead
    ).toBe("Could not start: no repo");
  });
});

describe("queueMenu", () => {
  const row = (over: Partial<QueuedTaskView>, up = true, down = true) => ({
    item: item("a", over),
    afterSessionId: null,
    canMoveUp: up,
    canMoveDown: down,
  });

  it("offers start now, move and remove while it waits", () => {
    expect(queueMenu(row({}, false, true))).toEqual([
      { action: "start", label: "Start now", disabled: false },
      { action: "up", label: "Move up", disabled: true },
      { action: "down", label: "Move down", disabled: false },
      { action: "remove", label: "Remove", disabled: false },
    ]);
  });

  it("only remove once it failed, nothing while it starts", () => {
    expect(queueMenu(row({ status: "failed" })).map((i) => i.action)).toEqual([
      "remove",
    ]);
    expect(queueMenu(row({ status: "starting" }))).toEqual([]);
  });
});

describe("queueRequest", () => {
  it("posts start and moves, deletes a removal", () => {
    expect(queueRequest("a/b", "start")).toEqual({
      url: "/api/tasks/queue/a%2Fb",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      },
    });
    expect(JSON.parse(queueRequest("a", "down").init.body as string)).toEqual({
      action: "down",
    });
    expect(queueRequest("a", "remove")).toEqual({
      url: "/api/tasks/queue/a",
      init: { method: "DELETE" },
    });
  });
});
