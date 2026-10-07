import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { getDb, type Session } from "@/lib/db";
import type { ChatConversation, ChatStartOptions } from "../driver";
import type { ChatItem, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { listItems } from "../store";
import { enqueue, listQueue } from "../queued";
import type { WorkerEvent } from "./protocol";

// A conversation the test drives by hand.
function fakeConversation() {
  const events = new InputQueue<DriverEvent>();
  const conversation = {
    send: vi.fn(() => "checkpoint-1"),
    runLocal: vi.fn((text: string): Promise<ChatItem[]> | null =>
      text === "/mcp"
        ? Promise.resolve([
            {
              id: "mcp-1",
              kind: "mcp",
              servers: [
                { name: "linear", status: "connected", tools: [{ name: "x" }] },
              ],
              createdAt: 1,
            },
          ])
        : null
    ),
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setAccess: vi.fn(async () => {}),
    respond: vi.fn(),
    stopTask: vi.fn(async () => {}),
    fileSuggestions: vi.fn(async (query: string) =>
      query === "boom"
        ? Promise.reject(new Error("index failed"))
        : [{ path: `lib/${query}.ts`, dir: false }]
    ),
    undo: vi.fn(),
    close: vi.fn(() => events.end()),
    events,
  } satisfies ChatConversation;
  return conversation;
}

let current: ReturnType<typeof fakeConversation>;
let started: ChatStartOptions | undefined;
vi.mock("../drivers", () => ({
  chatDriverFor: () => ({
    id: "fake",
    start: (options: ChatStartOptions) => {
      started = options;
      return current;
    },
  }),
}));

async function startHost(role = "agent") {
  const { ChatHost } = await import("./host");
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, role) VALUES (?, 'chat', ?, '/tmp', ?)`
    )
    .run(id, `claude-${id}`, role);
  const session = getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as Session;
  current = fakeConversation();
  const emitted: WorkerEvent[] = [];
  const host = new ChatHost(session, (e) => emitted.push(e));
  return { id, host, conversation: current, emitted };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ChatHost", () => {
  it("gives every chat the visuals tools, approved like any other", async () => {
    const { host } = await startHost();
    expect(Object.keys(started?.mcpServers ?? {})).toContain("visuals");
    // Not pre-approved: under "ask" they wait for the reader like Read does.
    expect(started?.allowedTools ?? []).not.toContainEqual(
      expect.stringContaining("visuals")
    );
    expect(started?.systemAppend).toMatch(/## Showing visuals/);
    host.close();
  });

  it("keeps a browser away from an orchestrator", async () => {
    const { host } = await startHost("orchestrator");
    expect(started?.mcpServers?.visuals).toBeUndefined();
    expect(started?.systemAppend ?? "").not.toMatch(/Showing visuals/);
    host.close();
  });

  it("passes an interrupt to the conversation", async () => {
    const { host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    await host.handle({ type: "interrupt" });
    expect(conversation.interrupt).toHaveBeenCalledOnce();
    host.close();
  });

  it("keeps what a cut-off turn streamed, saved and settled", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    conversation.events.push({
      type: "item",
      item: {
        id: "a1",
        kind: "assistant",
        text: "Half",
        streaming: true,
        createdAt: 1,
      },
    });
    conversation.events.push({ type: "delta", id: "a1", text: " a sentence" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("idle");
    expect(listItems(id).find((i) => i.id === "a1")).toMatchObject({
      text: "Half a sentence",
      streaming: false,
    });
    host.close();
  });

  it("answers /mcp itself, without starting a turn", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "/mcp" });
    expect(conversation.send).not.toHaveBeenCalled();
    expect(host.state).toBe("idle");
    expect(listItems(id).map((i) => i.kind)).toEqual(["user", "mcp"]);
    host.close();
  });

  it("shows a local command's failure without starting a turn", async () => {
    const { id, host, conversation } = await startHost();
    conversation.runLocal.mockReturnValueOnce(
      Promise.reject(new Error("query closed"))
    );
    await host.handle({ type: "send", id: "user-1", text: "/mcp" });
    expect(conversation.send).not.toHaveBeenCalled();
    expect(host.state).toBe("idle");
    const items = listItems(id);
    expect(items.map((i) => i.kind)).toEqual(["user", "error"]);
    expect(items[1]).toMatchObject({ message: "query closed" });
    host.close();
  });

  it("stores who sent a peer message, and gives the agent the full text", async () => {
    const { id, host, conversation } = await startHost();
    const text = `[AgentOS message from agent session "Session 3"]: hi. Reply with: aos send Session 3 "<message>"`;
    await host.handle({
      type: "send",
      id: "user-1",
      text,
      from: "Session 3",
      peer: { sessionId: "s3", body: "hi" },
    });
    expect(conversation.send).toHaveBeenCalledWith(text, undefined);
    expect(listItems(id)[0]).toMatchObject({
      kind: "user",
      text,
      from: "Session 3",
      peer: { sessionId: "s3", body: "hi" },
    });
    host.close();
  });
});

describe("ChatHost queue", () => {
  const userTexts = (id: string) =>
    listItems(id).flatMap((i) => (i.kind === "user" ? [i.text] : []));

  it("queues composer messages behind a running turn and sends them in order", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "long job",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "first",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-3",
      text: "second",
      queue: true,
    });
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.text)).toEqual(["first", "second"]);

    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("first", undefined);
    expect(host.state).toBe("running");
    expect(listQueue(id).map((m) => m.text)).toEqual(["second"]);

    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("second", undefined);
    expect(listQueue(id)).toEqual([]);
    expect(userTexts(id)).toEqual(["long job", "first", "second"]);
    host.close();
  });

  it("lets a message from the bus join the running turn, unqueued", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    await host.handle({ type: "send", id: "user-2", text: "from a peer" });
    expect(conversation.send).toHaveBeenCalledTimes(2);
    expect(listQueue(id)).toEqual([]);
    host.close();
  });

  it("sends a queued message only once, even when the send is retried", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "long job",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "next",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "next",
      queue: true,
    });
    expect(listQueue(id)).toHaveLength(1);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({
      type: "send",
      id: "user-2",
      text: "next",
      queue: true,
    });
    expect(conversation.send).toHaveBeenCalledTimes(2);
    expect(listQueue(id)).toEqual([]);
    host.close();
  });

  it("send now stops the turn and sends that message ahead of the rest", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "long job",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "later",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-3",
      text: "urgent",
      queue: true,
    });
    await host.handle({ type: "send_now", id: "user-3" });
    expect(conversation.interrupt).toHaveBeenCalledOnce();
    expect(listQueue(id).map((m) => m.text)).toEqual(["urgent", "later"]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("urgent", undefined);
    expect(listQueue(id).map((m) => m.text)).toEqual(["later"]);
    host.close();
  });

  it("send now with no turn running sends at once", async () => {
    const { id, host, conversation } = await startHost();
    enqueue(id, { id: "user-9", text: "left over" });
    await host.handle({ type: "send_now", id: "user-9" });
    expect(conversation.interrupt).not.toHaveBeenCalled();
    expect(conversation.send).toHaveBeenCalledWith("left over", undefined);
    host.close();
  });

  it("a message sent while idle goes behind ones left in the queue", async () => {
    const { id, host, conversation } = await startHost();
    enqueue(id, { id: "user-8", text: "left over" });
    await host.handle({ type: "send", id: "user-9", text: "new", queue: true });
    expect(conversation.send).toHaveBeenCalledWith("left over", undefined);
    expect(listQueue(id).map((m) => m.text)).toEqual(["new"]);
    host.close();
  });
});

describe("ChatHost queue across turns", () => {
  it("goes straight on to the next queued message, never idle in between", async () => {
    const { id, host, conversation, emitted } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "long",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "next",
      queue: true,
    });
    emitted.length = 0;
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    // A server on a newer build retires a worker as soon as it hears idle.
    expect(emitted).not.toContainEqual({ type: "state", state: "idle" });
    expect(conversation.send).toHaveBeenLastCalledWith("next", undefined);
    expect(host.state).toBe("running");
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(emitted).toContainEqual({ type: "state", state: "idle" });
    expect(listQueue(id)).toEqual([]);
    host.close();
  });

  it("ignores send now for a message that already left the queue", async () => {
    const { host, conversation } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "long",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "next",
      queue: true,
    });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    // user-2 is running now; a late tap on its Send now changes nothing.
    await host.handle({ type: "send_now", id: "user-2" });
    await host.handle({ type: "send_now", id: "user-gone" });
    expect(conversation.interrupt).not.toHaveBeenCalled();
    expect(conversation.send).toHaveBeenCalledTimes(2);
    host.close();
  });
});

describe("ChatHost drain", () => {
  it("sends what's queued when idle, and leaves a running turn alone", async () => {
    const { id, host, conversation } = await startHost();
    enqueue(id, { id: "user-8", text: "left over" });
    await host.handle({ type: "drain" });
    expect(conversation.send).toHaveBeenCalledWith("left over", undefined);
    enqueue(id, { id: "user-9", text: "after" });
    await host.handle({ type: "drain" });
    expect(conversation.interrupt).not.toHaveBeenCalled();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.text)).toEqual(["after"]);
    host.close();
  });
});

describe("ChatHost files", () => {
  it("answers an @mention lookup with the agent's matches", async () => {
    const { host, emitted } = await startHost();
    await host.handle({ type: "files", reqId: "r1", query: "queue" });
    expect(emitted).toContainEqual({
      type: "files_result",
      reqId: "r1",
      files: [{ path: "lib/queue.ts", dir: false }],
    });
    host.close();
  });

  it("reports a failed lookup, so the server can fall back", async () => {
    const { host, emitted } = await startHost();
    await host.handle({ type: "files", reqId: "r2", query: "boom" });
    expect(emitted).toContainEqual({
      type: "files_result",
      reqId: "r2",
      error: "index failed",
    });
    host.close();
  });
});

describe("ChatHost suggestion", () => {
  const stored = (id: string) =>
    (
      getDb()
        .prepare(`SELECT chat_suggestion FROM sessions WHERE id = ?`)
        .get(id) as { chat_suggestion: string | null }
    ).chat_suggestion;

  it("keeps the agent's guess on the session until the next message", async () => {
    const { id, host, conversation, emitted } = await startHost();
    conversation.events.push({ type: "suggestion", text: "run the tests" });
    await tick();
    expect(stored(id)).toBe("run the tests");
    expect(emitted).toContainEqual({
      type: "suggestion",
      text: "run the tests",
    });
    await host.handle({ type: "send", id: "user-1", text: "run the tests" });
    expect(stored(id)).toBeNull();
    expect(emitted).toContainEqual({ type: "suggestion", text: null });
    host.close();
  });
});

describe("lastUserTask", () => {
  it("shows a peer message's body, and survives a malformed one", async () => {
    const { lastUserTask, saveItem } = await import("../store");
    const id = randomUUID();
    saveItem(id, {
      id: "user-1",
      kind: "user",
      text: "[AgentOS message from …] hi. Reply with: …",
      peer: { sessionId: "s3", body: "hi" },
      createdAt: 1,
    });
    expect(lastUserTask(id)).toBe("hi");
    saveItem(id, {
      id: "user-2",
      kind: "user",
      text: "fallback",
      peer: { sessionId: "s3", body: 1 as unknown as string },
      createdAt: 2,
    });
    expect(lastUserTask(id)).toBe("fallback");
  });
});
