import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { WorkerCommand } from "./worker/protocol";
import type { ChatItem, ChatState } from "./events";

const { registry, emit } = await import("./registry");
const { saveItem } = await import("./store");
const { sendChatConfirmed } = await import("./runner");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");

type Send = Extract<WorkerCommand, { type: "send" }>;

// A connected worker that does what `onSend` says with each send.
function fakeWorker(state: ChatState, onSend: (id: string, cmd: Send) => void) {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  const sent: Send[] = [];
  registry.live.set(id, {
    worker: {
      command: (cmd: WorkerCommand) => {
        if (cmd.type !== "send") return;
        sent.push(cmd);
        onSend(id, cmd);
      },
    } as never,
    state,
    streaming: new Map(),
    activity: { tools: new Map(), tasks: new Set() },
  });
  return { id, sent };
}

const userItem = (cmd: Send): ChatItem => ({
  id: cmd.id,
  kind: "user",
  text: cmd.text,
  from: cmd.from,
  peer: cmd.peer,
  createdAt: Date.now(),
});

describe("sendChatConfirmed", () => {
  it("is delivered once the worker records the message", async () => {
    const { id, sent } = fakeWorker("idle", (sid, cmd) =>
      setTimeout(() => emit(sid, { type: "item", item: userItem(cmd) }), 5)
    );
    await expect(
      sendChatConfirmed(id, {
        text: "hi",
        from: "orch",
        peer: { sessionId: "o-1", body: "hi" },
      })
    ).resolves.toBe("delivered");
    expect(sent[0]).toMatchObject({
      text: "hi",
      from: "orch",
      peer: { sessionId: "o-1", body: "hi" },
    });
  });

  it("is queued when a turn was already running", async () => {
    const { id } = fakeWorker("running", (sid, cmd) =>
      emit(sid, { type: "item", item: userItem(cmd) })
    );
    await expect(sendChatConfirmed(id, { text: "hi" })).resolves.toBe("queued");
  });

  it("isn't confirmed by some other item", async () => {
    const { id } = fakeWorker("idle", (sid, cmd) =>
      emit(sid, { type: "item", item: { ...userItem(cmd), id: "other" } })
    );
    await expect(sendChatConfirmed(id, { text: "hi" }, 30)).rejects.toThrow(
      "didn't take it within"
    );
  });

  it("trusts the stored row when the event was missed", async () => {
    const { id } = fakeWorker("idle", (sid, cmd) =>
      saveItem(sid, userItem(cmd))
    );
    await expect(sendChatConfirmed(id, { text: "hi" }, 30)).resolves.toBe(
      "delivered"
    );
  });

  it("fails when the worker never takes it", async () => {
    const { id } = fakeWorker("idle", () => {});
    await expect(sendChatConfirmed(id, { text: "hi" }, 30)).rejects.toThrow(
      "didn't take it within"
    );
    expect(registry.listeners.get(id)?.size ?? 0).toBe(0);
  });
});
