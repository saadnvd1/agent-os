import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { getDb, type Session } from "@/lib/db";
import type { ChatConversation, ChatStartOptions } from "../driver";
import type { ChatItem, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { listItems, saveItem } from "../store";
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
    setPlan: vi.fn(async (_plan: boolean) => {}),
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
// Whether the fake driver says when it's at rest, as Claude does.
const driverFlags = vi.hoisted(() => ({ atRest: true }));
vi.mock("../drivers", () => ({
  chatDriverFor: () => ({
    id: "fake",
    atRest: driverFlags.atRest,
    start: (options: ChatStartOptions) => {
      started = options;
      return current;
    },
  }),
}));

async function startHost(
  role = "agent",
  saved?: { resumeId?: string; usage?: object },
  // What's saved before the worker starts.
  seed?: (id: string) => void
) {
  const { ChatHost } = await import("./host");
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, role) VALUES (?, 'chat', ?, '/tmp', ?)`
    )
    .run(id, `claude-${id}`, role);
  if (saved)
    getDb()
      .prepare(
        `UPDATE sessions SET claude_session_id = ?, chat_usage = ? WHERE id = ?`
      )
      .run(saved.resumeId ?? null, JSON.stringify(saved.usage), id);
  const session = getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as Session;
  seed?.(id);
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

describe("ChatHost origins", () => {
  it("marks a typed message as tagged with no origin, so it stays the reader's", async () => {
    const { id, host } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: '[Scheduled message "x"] typed',
    });
    const [item] = listItems(id);
    expect(item).toMatchObject({ kind: "user", tagged: true });
    expect(item).not.toHaveProperty("origin", expect.anything());
    host.close();
  });

  it("stores what sent an event, and the agent gets its text unchanged", async () => {
    const { id, host, conversation } = await startHost();
    const origin = { kind: "event", label: "AgentOS" } as const;
    await host.handle({
      type: "send",
      id: "user-1",
      text: "task x: review of 7ead8e8 passed",
      from: "agentos",
      origin,
    });
    expect(conversation.send).toHaveBeenCalledWith(
      "task x: review of 7ead8e8 passed",
      undefined
    );
    expect(listItems(id)[0]).toMatchObject({ kind: "user", origin });
    host.close();
  });

  it("keeps a queued message's origin when it's sent", async () => {
    const { id, host } = await startHost();
    const origin = {
      kind: "schedule",
      label: "Triage",
      body: "triage",
    } as const;
    enqueue(id, { id: "user-q", text: "[Scheduled message]", origin });
    await host.handle({ type: "drain" });
    expect(listItems(id)[0]).toMatchObject({ id: "user-q", origin });
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

  it("holds a send that lands as a move or Land takes hold, and what's queued, until it's let go", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    getDb()
      .prepare(`UPDATE sessions SET task_status = 'moving' WHERE id = ?`)
      .run(id);
    await host.handle({ type: "send", id: "user-2", text: "in flight" });
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.text)).toEqual(["in flight"]);
    // The turn ends: nothing queued starts while it's held.
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(host.state).toBe("idle");
    getDb()
      .prepare(`UPDATE sessions SET task_status = 'running' WHERE id = ?`)
      .run(id);
    await host.handle({ type: "drain" });
    expect(conversation.send).toHaveBeenLastCalledWith("in flight", undefined);
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

  it("send now stops the turn with the message, read before anything else", async () => {
    const { id, host, conversation, emitted } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "long job",
      queue: true,
    });
    conversation.events.push({ type: "turn_start" });
    await tick();
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
    await host.handle({ type: "send_now", id: "user-3", during: "user-1" });
    // Handed over with the stop, not after the stopped turn has ended: by
    // then the agent may have started on a notice it queued itself.
    expect(conversation.send).toHaveBeenLastCalledWith("urgent", undefined, {
      now: true,
    });
    expect(listQueue(id).map((m) => m.text)).toEqual(["later"]);
    // Saved at once, shown once the stopped turn has ended, so it reads
    // after it.
    expect(listItems(id).filter((i) => i.kind === "user")).toHaveLength(2);
    expect(emitted).not.toContainEqual({
      type: "item",
      item: expect.objectContaining({ id: "user-3" }),
    });
    conversation.events.push({
      type: "item",
      item: { id: "end-1", kind: "turn_end", interrupted: true, createdAt: 2 },
    });
    // The stopped turn's end is not idle: "urgent" runs straight on.
    emitted.length = 0;
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(listItems(id).map((i) => i.id)).toEqual([
      "user-1",
      "end-1",
      "user-3",
    ]);
    expect(emitted).toContainEqual({
      type: "item",
      item: expect.objectContaining({ id: "user-3" }),
    });
    expect(host.state).toBe("running");
    expect(emitted).not.toContainEqual({ type: "state", state: "idle" });
    expect(conversation.send).toHaveBeenCalledTimes(2);
    // Its end sends the rest of the queue.
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("later", undefined);
    expect(listQueue(id)).toEqual([]);
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("idle");
    host.close();
  });

  it("a message typed after Esc, before the turn stopped, goes as if sent now", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "interrupt" });
    expect(conversation.interrupt).toHaveBeenCalledOnce();
    await host.handle({
      type: "send",
      id: "user-2",
      text: "do this instead",
      queue: true,
    });
    expect(conversation.send).toHaveBeenLastCalledWith(
      "do this instead",
      undefined,
      { now: true }
    );
    expect(listQueue(id)).toEqual([]);
    // Only the first: a second one waits its turn.
    await host.handle({
      type: "send",
      id: "user-3",
      text: "and then this",
      queue: true,
    });
    expect(listQueue(id).map((m) => m.text)).toEqual(["and then this"]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("running");
    expect(conversation.send).toHaveBeenCalledTimes(2);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith(
      "and then this",
      undefined
    );
    host.close();
  });

  it("a message typed after the stopped turn ended goes as usual", async () => {
    const { host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    await host.handle({ type: "interrupt" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({
      type: "send",
      id: "user-2",
      text: "next",
      queue: true,
    });
    expect(conversation.send).toHaveBeenLastCalledWith("next", undefined);
    host.close();
  });

  it("a message typed while the agent starts on its own straight after Esc goes now", async () => {
    const { host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    await host.handle({ type: "interrupt" });
    conversation.events.push({ type: "state", state: "idle" });
    // The agent starts on a background task's notice the moment it stops.
    conversation.events.push({ type: "turn_start" });
    await tick();
    expect(host.state).toBe("running");
    await host.handle({ type: "send", id: "user-2", text: "hey", queue: true });
    expect(conversation.send).toHaveBeenLastCalledWith("hey", undefined, {
      now: true,
    });
    host.close();
  });

  it("a turn the agent starts long after Esc isn't stopped for a message", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "long job" });
    await host.handle({ type: "interrupt" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "hey", queue: true });
    clock.mockRestore();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.text)).toEqual(["hey"]);
    host.close();
  });

  it("Esc sends what's queued with the stop", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A", queue: true });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "B", queue: true });
    await host.handle({ type: "interrupt" });
    expect(conversation.send).toHaveBeenLastCalledWith("B", undefined, {
      now: true,
    });
    // The send stops the turn: no second stop on top.
    expect(conversation.interrupt).not.toHaveBeenCalled();
    expect(listQueue(id)).toEqual([]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("running");
    expect(listItems(id).at(-1)?.id).toBe("user-2");
    host.close();
  });

  it("another agent's message after Esc waits its turn", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A" });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "interrupt" });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "from a peer",
      from: "Session 3",
      peer: { sessionId: "s3", body: "from a peer" },
      queue: true,
    });
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.text)).toEqual(["from a peer"]);
    host.close();
  });

  it("a stopped turn the agent never started can't hold the message's own end", async () => {
    const { host, conversation, emitted } = await startHost();
    // Sent, and sent now before the agent reports starting on the first.
    await host.handle({ type: "send", id: "user-1", text: "A", queue: true });
    await host.handle({ type: "send", id: "user-2", text: "B", queue: true });
    await host.handle({ type: "send_now", id: "user-2", during: "user-1" });
    expect(emitted).toContainEqual({
      type: "item",
      item: expect.objectContaining({ id: "user-2" }),
    });
    // The only end that comes is B's: the chat goes idle.
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("idle");
    host.close();
  });

  it("a stopped turn that never sends its result can't hold the chat running", async () => {
    const { ClaudeMapper } = await import("../drivers/claude-mapper");
    const mapper = new ClaudeMapper();
    const feed = (m: Parameters<typeof mapper.map>[0]) => {
      for (const e of mapper.map(m)) conversation.events.push(e);
    };
    const { host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A", queue: true });
    feed({ type: "system", subtype: "init", session_id: "s" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "B", queue: true });
    await host.handle({ type: "send_now", id: "user-2", during: "user-1" });
    // A's turn sends no result; B's starts, and ends.
    feed({ type: "system", subtype: "init", session_id: "s" });
    feed({ type: "result", subtype: "success", result: "done" });
    await tick();
    expect(host.state).toBe("idle");
    host.close();
  });

  it("two messages sent now in a row: only the last one's end is idle", async () => {
    const { host, conversation, emitted } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "T", queue: true });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "A", queue: true });
    await host.handle({ type: "send_now", id: "user-2", during: "user-1" });
    await host.handle({ type: "send", id: "user-3", text: "B", queue: true });
    await host.handle({ type: "send_now", id: "user-3", during: "user-2" });
    emitted.length = 0;
    // T stops; A starts and B stops it; B starts and ends.
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("running");
    expect(emitted).not.toContainEqual({ type: "state", state: "idle" });
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("idle");
    host.close();
  });

  it("a handed-over message is saved at once, and shown if the agent goes away", async () => {
    const { id, host, conversation, emitted } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A", queue: true });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "B", queue: true });
    await host.handle({ type: "send_now", id: "user-2", during: "user-1" });
    expect(listItems(id).map((i) => i.id)).toContain("user-2");
    conversation.events.end();
    await host.done;
    expect(emitted).toContainEqual({
      type: "item",
      item: expect.objectContaining({ id: "user-2" }),
    });
    // Off the queue, saved once: a worker after this won't send it again.
    expect(listQueue(id)).toEqual([]);
    expect(listItems(id).filter((i) => i.id === "user-2")).toHaveLength(1);
    expect(listItems(id).at(-1)?.id).toBe("user-2");
    host.close();
  });

  it("a turn the agent starts itself holds what's sent until it ends", async () => {
    const { id, host, conversation, emitted } = await startHost();
    conversation.events.push({ type: "turn_start" });
    await tick();
    expect(host.state).toBe("running");
    expect(emitted).toContainEqual({ type: "state", state: "running" });
    await host.handle({ type: "send", id: "user-1", text: "hi", queue: true });
    expect(conversation.send).not.toHaveBeenCalled();
    expect(listQueue(id).map((m) => m.text)).toEqual(["hi"]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("hi", undefined);
    // A turn already running is ours: its start changes nothing.
    conversation.events.push({ type: "turn_start" });
    await tick();
    expect(host.state).toBe("running");
    host.close();
  });

  it("send now leaves alone a turn that started after the tap", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A", queue: true });
    await host.handle({ type: "send", id: "user-2", text: "B", queue: true });
    await host.handle({ type: "send", id: "user-3", text: "C", queue: true });
    // A ends and B starts while the tap on C's Send now is on its way.
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({ type: "send_now", id: "user-3", during: "user-1" });
    expect(conversation.interrupt).not.toHaveBeenCalled();
    // C still goes next, once B has had its reply.
    expect(listQueue(id).map((m) => m.text)).toEqual(["C"]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("C", undefined);
    host.close();
  });

  it("send now from an old client, with no turn named, doesn't interrupt", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A", queue: true });
    await host.handle({ type: "send", id: "user-2", text: "B", queue: true });
    await host.handle({ type: "send_now", id: "user-2" });
    expect(conversation.interrupt).not.toHaveBeenCalled();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.text)).toEqual(["B"]);
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
    await host.handle({ type: "send_now", id: "user-2", during: "user-2" });
    await host.handle({ type: "send_now", id: "user-gone", during: "user-2" });
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

  it("sends a message only after a plan mode change reaches the agent", async () => {
    const { host, conversation } = await startHost();
    let finish = () => {};
    conversation.setPlan.mockImplementationOnce(
      () => new Promise<void>((r) => (finish = r))
    );
    void host.handle({ type: "set_plan", plan: false });
    const sending = host.handle({ type: "send", id: "user-1", text: "go" });
    await tick();
    expect(conversation.send).not.toHaveBeenCalled();
    finish();
    await sending;
    expect(conversation.send).toHaveBeenCalledOnce();
    host.close();
  });

  it("sends a queued message only after a plan mode change reaches the agent", async () => {
    const { host, conversation } = await startHost();
    await host.handle({
      type: "send",
      id: "user-1",
      text: "plan",
      queue: true,
    });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "do it",
      queue: true,
    });
    let finish = () => {};
    conversation.setPlan.mockImplementationOnce(
      () => new Promise<void>((r) => (finish = r))
    );
    // Carry it out: plan mode goes off as the planning turn ends.
    void host.handle({ type: "set_plan", plan: false });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    finish();
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("do it", undefined);
    host.close();
  });

  it("doesn't report idle over a turn a waiting send started", async () => {
    const { host, conversation, emitted } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "first" });
    let finish = () => {};
    conversation.setPlan.mockImplementationOnce(
      () => new Promise<void>((r) => (finish = r))
    );
    void host.handle({ type: "set_plan", plan: false });
    const sending = host.handle({ type: "send", id: "user-2", text: "next" });
    // The first turn ends while the plan change is still on its way.
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    emitted.length = 0;
    finish();
    await sending;
    await tick();
    expect(conversation.send).toHaveBeenLastCalledWith("next", undefined);
    expect(host.state).toBe("running");
    expect(emitted).not.toContainEqual({ type: "state", state: "idle" });
    host.close();
  });

  it("records each turn's cost as the difference in running totals", async () => {
    const { id, host, conversation, emitted } = await startHost();
    const totals = (costUsd: number, inputTokens: number) => ({
      costUsd,
      inputTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    conversation.events.push({ type: "usage", totals: totals(0.5, 100) });
    conversation.events.push({ type: "usage", totals: totals(0.75, 150) });
    conversation.events.push({
      type: "context",
      context: {
        usedTokens: 10,
        maxTokens: 100,
        percentage: 10,
        categories: [],
        at: 1,
      },
    });
    await tick();
    const turns = getDb()
      .prepare(
        `SELECT cost_usd, input_tokens FROM chat_turns WHERE session_id = ? ORDER BY id`
      )
      .all(id);
    expect(turns).toEqual([
      { cost_usd: 0.5, input_tokens: 100 },
      { cost_usd: 0.25, input_tokens: 50 },
    ]);
    expect(emitted.some((e) => e.type === "context")).toBe(true);
    const saved = getDb()
      .prepare(`SELECT chat_context FROM sessions WHERE id = ?`)
      .get(id) as { chat_context: string };
    expect(JSON.parse(saved.chat_context).percentage).toBe(10);
    host.close();
  });

  describe("the first turn after a worker starts", () => {
    const totals = (costUsd: number) => ({
      costUsd,
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const costs = (id: string) =>
      getDb()
        .prepare(`SELECT cost_usd FROM chat_turns WHERE session_id = ?`)
        .all(id)
        .map((r) => (r as { cost_usd: number }).cost_usd);

    it("counts from the saved totals when the conversation resumes", async () => {
      const { id, host, conversation } = await startHost("agent", {
        resumeId: "conv-1",
        usage: totals(0.4),
      });
      conversation.events.push({ type: "usage", totals: totals(1) });
      await tick();
      expect(costs(id)[0]).toBeCloseTo(0.6);
      host.close();
    });

    it("counts all of it in a new conversation, whatever an old one left", async () => {
      const { id, host, conversation } = await startHost("agent", {
        usage: totals(0.4),
      });
      conversation.events.push({ type: "usage", totals: totals(1) });
      conversation.events.push({ type: "usage", totals: totals(1.5) });
      await tick();
      expect(costs(id)).toEqual([1, 0.5]);
      host.close();
    });

    it("counts from what the agent restored, not what was saved", async () => {
      // The last worker died without saving its totals: the agent starts
      // from nothing although the session saved 0.4.
      const { id, host, conversation } = await startHost("agent", {
        resumeId: "conv-1",
        usage: totals(0.4),
      });
      conversation.events.push({ type: "usage_start", totals: totals(0) });
      conversation.events.push({ type: "usage", totals: totals(0.6) });
      await tick();
      expect(costs(id)).toEqual([0.6]);
      host.close();
    });

    it("ignores a starting point that arrives after a turn was measured", async () => {
      const { id, host, conversation } = await startHost("agent", {
        resumeId: "conv-1",
        usage: totals(0.4),
      });
      conversation.events.push({ type: "usage", totals: totals(1) });
      conversation.events.push({ type: "usage_start", totals: totals(0) });
      conversation.events.push({ type: "usage", totals: totals(1.25) });
      await tick();
      expect(costs(id).map((c) => +c.toFixed(2))).toEqual([0.6, 0.25]);
      host.close();
    });
  });
});

describe("ChatHost cut-off tool calls", () => {
  const tool = (id: string, createdAt = 1) =>
    ({
      id,
      kind: "tool",
      name: "Bash",
      title: "Confirm deploy health",
      input: {},
      status: "running",
      createdAt,
    }) as const;

  it("stops a call a worker before this one left running", async () => {
    const { id, host } = await startHost("agent", undefined, (id) =>
      saveItem(id, tool("t-old"))
    );
    expect(listItems(id).find((i) => i.id === "t-old")).toMatchObject({
      status: "stopped",
    });
    host.close();
  });

  it("stops a call with no result when the turn ends", async () => {
    const { id, host, conversation, emitted } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "deploy" });
    conversation.events.push({ type: "item", item: tool("t1") });
    await tick();
    expect(listItems(id).find((i) => i.id === "t1")).toMatchObject({
      status: "running",
    });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(listItems(id).find((i) => i.id === "t1")).toMatchObject({
      status: "stopped",
    });
    expect(emitted).toContainEqual({
      type: "item",
      item: expect.objectContaining({ id: "t1", status: "stopped" }),
    });
    host.close();
  });
});

describe("ChatHost retiring after a deploy", () => {
  const bus = {
    from: "agentos",
    origin: { kind: "event" as const, label: "AgentOS" },
  };

  it("waits out a running turn, queues what arrives meanwhile, and closes once at its end", async () => {
    const { id, host, conversation } = await startHost("orchestrator");
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "retire" });
    expect(conversation.close).not.toHaveBeenCalled();
    // An event mid-turn waits for the current worker, not this agent.
    await host.handle({ type: "send", id: "user-2", text: "event", ...bus });
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-2"]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
    // Not sent by this worker: the next one sends it.
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-2"]);
    await host.done;
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("doesn't close at a turn's end while its agent holds a message it took in mid-turn", async () => {
    const { host, conversation } = await startHost("orchestrator");
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "send", id: "user-2", text: "event", ...bus });
    await host.handle({ type: "retire" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).not.toHaveBeenCalled();
    // The agent runs it as its next turn, and then it's a boundary.
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("closes once the agent says it ran everything, when it took the message into the same turn", async () => {
    const { host, conversation } = await startHost("orchestrator");
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "send", id: "user-2", text: "event", ...bus });
    await host.handle({ type: "retire" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).not.toHaveBeenCalled();
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    expect(conversation.close).not.toHaveBeenCalled();
    conversation.events.push({ type: "at_rest" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("goes straight away when idle with a guess already in", async () => {
    const { host, conversation } = await startHost();
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    await host.handle({ type: "retire" });
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("idle with nothing queued, waits for the agent's guess, then goes", async () => {
    const { host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "work" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({ type: "retire" });
    expect(conversation.close).not.toHaveBeenCalled();
    conversation.events.push({ type: "suggestion", text: "run the tests" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("with no guess coming, goes after a while", async () => {
    vi.useFakeTimers();
    try {
      const { RETIRE_SUGGESTION_WAIT_MS } = await import("./host");
      const { host, conversation } = await startHost();
      await host.handle({ type: "retire" });
      vi.advanceTimersByTime(RETIRE_SUGGESTION_WAIT_MS - 1);
      expect(conversation.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(conversation.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("while its background work runs, carries on as usual, and goes once it ends", async () => {
    const { id, host, conversation } = await startHost();
    const task: ChatItem = {
      id: "task-1",
      kind: "task",
      taskId: "t1",
      description: "dev server",
      status: "running",
      createdAt: 1,
    };
    conversation.events.push({ type: "item", item: task });
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    await host.handle({ type: "retire" });
    expect(conversation.close).not.toHaveBeenCalled();
    // A message isn't held back for as long as the shell runs.
    await host.handle({ type: "send", id: "user-1", text: "still there?" });
    expect(conversation.send).toHaveBeenLastCalledWith(
      "still there?",
      undefined
    );
    expect(listQueue(id)).toEqual([]);
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    expect(conversation.close).not.toHaveBeenCalled();
    conversation.events.push({
      type: "item",
      item: { ...task, status: "completed" },
    });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("with a driver that never says it's at rest, a turn's end is the boundary", async () => {
    driverFlags.atRest = false;
    try {
      const { host, conversation } = await startHost();
      await host.handle({ type: "send", id: "user-1", text: "work" });
      // Steered into the running turn, as Codex does.
      await host.handle({ type: "send", id: "user-2", text: "also", ...bus });
      await host.handle({ type: "retire" });
      conversation.events.push({ type: "state", state: "idle" });
      conversation.events.push({ type: "suggestion", text: "next" });
      await tick();
      expect(conversation.close).toHaveBeenCalledOnce();
    } finally {
      driverFlags.atRest = true;
    }
  });

  it("send now stops the turn and leaves the message for the next worker", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "retire" });
    await host.handle({
      type: "send",
      id: "user-2",
      text: "stop",
      queue: true,
    });
    await host.handle({ type: "send_now", id: "user-2", during: "user-1" });
    expect(conversation.interrupt).toHaveBeenCalledOnce();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-2"]);
    host.close();
  });

  it("the worker after it resumes the conversation as the agent last named it", async () => {
    const { id, host, conversation } = await startHost("orchestrator", {
      resumeId: "conv-7",
    });
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "retire" });
    conversation.events.push({ type: "resume_id", id: "conv-8" });
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
    const { ChatHost } = await import("./host");
    const session = getDb()
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as Session;
    current = fakeConversation();
    const next = new ChatHost(session, () => {});
    expect(started?.resumeId).toBe("conv-8");
    next.close();
  });

  it("taking over from a retired worker, tells the agent once, ahead of its next message", async () => {
    const { RESTARTED_NOTE } = await import("./host");
    const { id, host, conversation } = await startHost("orchestrator");
    await host.handle({ type: "restarted" });
    await host.handle({ type: "send", id: "user-1", text: "an event" });
    expect(conversation.send).toHaveBeenLastCalledWith(
      `${RESTARTED_NOTE}\n\nan event`,
      undefined
    );
    // The chat shows what was sent, not the note.
    expect(listItems(id).find((i) => i.id === "user-1")).toMatchObject({
      text: "an event",
    });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "another" });
    expect(conversation.send).toHaveBeenLastCalledWith("another", undefined);
    host.close();
  });
});
