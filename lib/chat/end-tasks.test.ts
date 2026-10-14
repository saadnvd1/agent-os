import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";

const { default: migration } =
  await import("../db/migrations/20261014T2200_end_orphaned_tasks");
const { getDb } = await import("@/lib/db");
const {
  saveItem,
  getItem,
  endOrphanedTasks,
  endRunningTasks,
  sessionsWithRunningTasks,
} = await import("./store");

function chatWith(toolStatus: "stopped" | "error" | "done" | "running") {
  const id = randomUUID();
  const items: ChatItem[] = [
    {
      id: "toolu_1",
      kind: "tool",
      name: "Bash",
      title: "wait",
      input: {},
      status: toolStatus,
      createdAt: 1,
    },
    {
      id: "task-b1",
      kind: "task",
      taskId: "b1",
      toolUseId: "toolu_1",
      description: "Wait until deploy",
      status: "running",
      createdAt: 2,
    },
  ];
  for (const i of items) saveItem(id, i);
  return id;
}

describe("ending background tasks", () => {
  it.each(["stopped", "error"] as const)(
    "ends a running task whose tool is %s",
    (status) => {
      const id = chatWith(status);
      const ended = endOrphanedTasks(id);
      expect(ended.map((t) => t.taskId)).toEqual(["b1"]);
      const task = getItem(id, "task-b1");
      expect(task).toMatchObject({ status: "stopped" });
      expect((task as { endedAt?: number }).endedAt).toBeGreaterThan(0);
    }
  );

  it("leaves a task whose tool finished or still runs", () => {
    for (const s of ["done", "running"] as const) {
      const id = chatWith(s);
      expect(endOrphanedTasks(id)).toEqual([]);
      expect(getItem(id, "task-b1")).toMatchObject({ status: "running" });
    }
  });

  it("ends every running task when its agent is gone", () => {
    const id = chatWith("done");
    expect(sessionsWithRunningTasks()).toContain(id);
    expect(endRunningTasks(id)).toHaveLength(1);
    expect(getItem(id, "task-b1")).toMatchObject({ status: "stopped" });
    expect(sessionsWithRunningTasks()).not.toContain(id);
  });

  it("the migration settles rows already stuck", () => {
    const stuck = chatWith("stopped");
    const alive = chatWith("done");
    migration.up(getDb());
    expect(getItem(stuck, "task-b1")).toMatchObject({ status: "stopped" });
    expect(getItem(alive, "task-b1")).toMatchObject({ status: "running" });
  });
});
