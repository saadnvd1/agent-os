import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem, ChatServerMessage } from "./events";

const { saveItem } = await import("./store");
const { watchChat, chatHistory } = await import("./runner");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");
const { PAGE_ITEMS } = await import("./page");

function longChat(n: number) {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  for (let i = 0; i < n; i++)
    saveItem(id, { id: `m${i}`, kind: "assistant", text: "hi", createdAt: i });
  saveItem(id, {
    id: "task-old",
    kind: "task",
    taskId: "t1",
    description: "a background shell",
    status: "running",
    createdAt: 0,
  } as ChatItem);
  return id;
}

function snapshot(id: string, paged: boolean) {
  const sent: ChatServerMessage[] = [];
  const stop = watchChat(id, (m) => sent.push(m), paged);
  stop();
  const snap = sent.find((m) => m.type === "snapshot");
  if (snap?.type !== "snapshot") throw new Error("no snapshot");
  return snap;
}

describe("watchChat", () => {
  it("sends a paged client the latest page and pages the rest in", () => {
    const id = longChat(PAGE_ITEMS + 30);
    const snap = snapshot(id, true);
    expect(snap.items).toHaveLength(PAGE_ITEMS);
    expect(snap.items.at(-1)?.id).toBe("task-old");
    expect(snap.hasMore).toBe(true);
    const older = chatHistory(id, snap.cursor!);
    expect(older.items).toHaveLength(31);
    expect(older.hasMore).toBe(false);
  });

  it("lists background tasks from before the page", () => {
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp/p",
    });
    const id = seedSession({ projectId: project.id, name: "c", view: "chat" });
    saveItem(id, {
      id: "task-old",
      kind: "task",
      taskId: "t1",
      description: "a background shell",
      status: "running",
      createdAt: 0,
    } as ChatItem);
    for (let i = 0; i < PAGE_ITEMS + 5; i++)
      saveItem(id, { id: `m${i}`, kind: "assistant", text: "", createdAt: i });
    // No worker: a task saved as running was cut off.
    expect(snapshot(id, true).tasks).toMatchObject([
      { id: "task-old", status: "stopped" },
    ]);
  });

  it("sends every item to a client that didn't ask for pages", () => {
    const id = longChat(PAGE_ITEMS + 30);
    const snap = snapshot(id, false);
    expect(snap.items).toHaveLength(PAGE_ITEMS + 31);
    expect(snap.hasMore).toBe(false);
  });
});
