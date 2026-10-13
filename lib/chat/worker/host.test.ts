import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { getDb, type Session } from "@/lib/db";
import type { ChatConversation, ChatStartOptions } from "../driver";
import type { ChatItem, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { listItems, saveItem } from "../store";
import { enqueue, listQueue } from "../queued";
import type { WorkerEvent } from "./protocol";
import type { RoleExtras } from "./extras";
import { COMPACT_INSTRUCTIONS } from "../working-state";
import { setNoApprovals } from "@/lib/approvals/no-approvals";

const COMPACT_CMD = `/compact ${COMPACT_INSTRUCTIONS}`;

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
    backgroundTask: vi.fn(async (id?: string) => {
      if (id === "boom") throw new Error("background tasks are off");
      return id !== "gone";
    }),
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
  seed?: (id: string) => void,
  extras?: RoleExtras
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
  seed?.(id);
  const session = getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as Session;
  current = fakeConversation();
  const emitted: WorkerEvent[] = [];
  const host = new ChatHost(session, (e) => emitted.push(e), extras);
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

  it("loads only AgentOS's MCP servers for an agent on a routed provider", async () => {
    const plain = await startHost();
    expect(started?.strictMcpConfig).toBe(false);
    plain.host.close();
    const routed = await startHost("agent", undefined, (id) =>
      getDb()
        .prepare(`UPDATE sessions SET model_provider = 'deepseek' WHERE id = ?`)
        .run(id)
    );
    expect(started?.strictMcpConfig).toBe(true);
    routed.host.close();
  });

  it("keeps a browser away from an orchestrator", async () => {
    const { host } = await startHost("orchestrator");
    expect(started?.mcpServers?.visuals).toBeUndefined();
    expect(started?.systemAppend ?? "").not.toMatch(/Showing visuals/);
    host.close();
  });

  describe("No approvals mode", () => {
    const card = (id: string, extra: object = {}) =>
      ({
        id,
        kind: "approval",
        toolName: "Bash",
        title: "Run ls",
        input: {},
        canAlways: false,
        status: "pending",
        createdAt: 1,
        ...extra,
      }) as ChatItem;
    const askAccess = (id: string) =>
      getDb()
        .prepare(`UPDATE sessions SET chat_access = 'ask' WHERE id = ?`)
        .run(id);

    it("starts every chat at full access, and leaves the stored choice", async () => {
      setNoApprovals(true);
      try {
        const { id, host } = await startHost("agent", undefined, askAccess);
        expect(started?.access).toBe("full");
        expect(
          (
            getDb()
              .prepare(`SELECT chat_access FROM sessions WHERE id = ?`)
              .get(id) as { chat_access: string }
          ).chat_access
        ).toBe("ask");
        host.close();
      } finally {
        setNoApprovals(false);
      }
      const off = await startHost("agent", undefined, askAccess);
      expect(started?.access).toBe("ask");
      off.host.close();
    });

    it("allows a tool card as it appears, and marks it", async () => {
      setNoApprovals(true);
      try {
        const { host, conversation, emitted } = await startHost();
        conversation.events.push({ type: "item", item: card("ap-1") });
        await tick();
        expect(conversation.respond).toHaveBeenCalledWith("ap-1", {
          decision: "allow",
        });
        conversation.events.push({
          type: "item",
          item: card("ap-1", { status: "allowed" }),
        });
        await tick();
        const settled = emitted
          .filter((e) => e.type === "item")
          .map((e) => (e as { item: ChatItem }).item)
          .filter((i) => i.id === "ap-1" && i.kind === "approval")
          .at(-1);
        expect(settled).toMatchObject({ status: "allowed", auto: true });
        host.close();
      } finally {
        setNoApprovals(false);
      }
    });

    it("leaves a question for the reader, and waits for everything when off", async () => {
      const { host, conversation } = await startHost();
      conversation.events.push({ type: "item", item: card("ap-off") });
      await tick();
      expect(conversation.respond).not.toHaveBeenCalled();
      setNoApprovals(true);
      try {
        conversation.events.push({
          type: "item",
          item: card("ap-q", {
            toolName: "AskUserQuestion",
            questions: [
              {
                question: "Which?",
                header: "h",
                multiSelect: false,
                options: [],
              },
            ],
          }),
        });
        await tick();
        expect(conversation.respond).not.toHaveBeenCalledWith(
          "ap-q",
          expect.anything()
        );
        // Switching it on allows what was already waiting.
        await host.handle({ type: "set_access", access: "ask" });
        expect(conversation.setAccess).toHaveBeenCalledWith("full");
        expect(conversation.respond).toHaveBeenCalledWith("ap-off", {
          decision: "allow",
        });
        host.close();
      } finally {
        setNoApprovals(false);
      }
    });
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

  describe("batched item writes", () => {
    const stored = (id: string, itemId: string) =>
      (
        getDb()
          .prepare(
            `SELECT data FROM chat_items WHERE session_id = ? AND item_id = ?`
          )
          .get(id, itemId) as { data: string } | undefined
      )?.data;
    const partial = (text: string): DriverEvent => ({
      type: "item",
      item: {
        id: "a1",
        kind: "assistant",
        text,
        streaming: true,
        createdAt: 1,
      },
    });

    it("holds streaming updates, but writes a completed item and pushes every one live", async () => {
      const { id, host, conversation, emitted } = await startHost();
      await host.handle({ type: "send", id: "user-1", text: "go" });
      conversation.events.push(partial("He"));
      conversation.events.push(partial("Hel"));
      await tick();
      expect(emitted.filter((e) => e.type === "item")).toHaveLength(3);
      // A crash here loses only the partial text, never the sent message.
      expect(stored(id, "user-1")).toBeDefined();
      expect(stored(id, "a1")).toBeUndefined();
      conversation.events.push({
        type: "item",
        item: { id: "a1", kind: "assistant", text: "Hello", createdAt: 1 },
      });
      await tick();
      expect(stored(id, "a1")).toContain("Hello");
      host.close();
    });

    it("flushes at the end of a turn", async () => {
      const { id, host, conversation } = await startHost();
      conversation.events.push(partial("Hel"));
      await tick();
      expect(stored(id, "a1")).toBeUndefined();
      conversation.events.push({ type: "state", state: "idle" });
      await tick();
      expect(stored(id, "a1")).toContain("Hel");
      host.close();
    });

    it("flushes on an interrupt", async () => {
      const { id, host, conversation } = await startHost();
      await host.handle({ type: "send", id: "user-1", text: "go" });
      conversation.events.push(partial("Hel"));
      await tick();
      expect(stored(id, "a1")).toBeUndefined();
      await host.handle({ type: "interrupt" });
      expect(stored(id, "a1")).toContain("Hel");
      host.close();
    });

    it("flushes when the worker closes", async () => {
      const { id, host, conversation } = await startHost();
      conversation.events.push(partial("Hel"));
      await tick();
      expect(stored(id, "a1")).toBeUndefined();
      host.close();
      expect(stored(id, "a1")).toContain("Hel");
    });
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

  it("after a hard stop, another agent's message runs as the next turn", async () => {
    const { id, host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A" });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "interrupt", hard: true });
    expect(conversation.interrupt).toHaveBeenCalledOnce();
    await host.handle({
      type: "send",
      id: "user-2",
      text: "from a peer",
      from: "Session 3",
      peer: { sessionId: "s3", body: "from a peer" },
      queue: true,
    });
    expect(conversation.send).toHaveBeenLastCalledWith(
      "from a peer",
      undefined,
      { now: true }
    );
    expect(listQueue(id)).toEqual([]);
    host.close();
  });

  it("a hard stop cuts short the turn the agent starts to answer it", async () => {
    const { host, conversation } = await startHost();
    await host.handle({ type: "send", id: "user-1", text: "A" });
    conversation.events.push({ type: "turn_start" });
    await tick();
    await host.handle({ type: "interrupt", hard: true });
    conversation.events.push({ type: "turn_start" });
    await tick();
    expect(conversation.interrupt).toHaveBeenCalledTimes(2);
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

describe("ChatHost background_task", () => {
  it("answers with whether anything moved", async () => {
    const { host, emitted } = await startHost();
    await host.handle({
      type: "background_task",
      reqId: "b1",
      toolUseId: "t1",
    });
    await host.handle({
      type: "background_task",
      reqId: "b2",
      toolUseId: "gone",
    });
    expect(current.backgroundTask).toHaveBeenCalledWith("t1");
    expect(emitted).toContainEqual({
      type: "background_result",
      reqId: "b1",
      ok: true,
    });
    expect(emitted).toContainEqual({
      type: "background_result",
      reqId: "b2",
      ok: false,
    });
    host.close();
  });

  it("reports a refusal instead of dropping the request", async () => {
    const { host, emitted } = await startHost();
    await host.handle({
      type: "background_task",
      reqId: "b3",
      toolUseId: "boom",
    });
    expect(emitted).toContainEqual({
      type: "background_result",
      reqId: "b3",
      error: "background tasks are off",
    });
    host.close();
  });

  it("says so when the agent can't", async () => {
    const { host, emitted } = await startHost();
    delete (current as { backgroundTask?: unknown }).backgroundTask;
    await host.handle({ type: "background_task", reqId: "b4" });
    expect(emitted).toContainEqual({
      type: "background_result",
      reqId: "b4",
      error: "unsupported",
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
    // Its notice is the agent's next turn: that runs here first.
    expect(conversation.close).not.toHaveBeenCalled();
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("a background task's notice that never starts a turn doesn't keep it for long", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { RETIRE_REST_WAIT_MS } = await import("./host");
      const { host, conversation } = await startHost();
      const task: ChatItem = {
        id: "task-2",
        kind: "task",
        taskId: "t2",
        description: "subagent",
        status: "running",
        createdAt: 1,
      };
      conversation.events.push({ type: "item", item: task });
      conversation.events.push({ type: "suggestion", text: "next" });
      await vi.advanceTimersByTimeAsync(0);
      await host.handle({ type: "retire" });
      conversation.events.push({
        type: "item",
        item: { ...task, status: "stopped" },
      });
      await vi.advanceTimersByTimeAsync(0);
      vi.advanceTimersByTime(RETIRE_REST_WAIT_MS - 1);
      expect(conversation.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(conversation.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("with the queue full, the agent takes a message as before rather than lose it", async () => {
    const { MAX_QUEUED } = await import("../queued");
    const { id, host, conversation } = await startHost("orchestrator");
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "retire" });
    for (let i = 0; i < MAX_QUEUED; i++)
      await host.handle({ type: "send", id: `user-q${i}`, text: "e", ...bus });
    expect(listQueue(id)).toHaveLength(MAX_QUEUED);
    await host.handle({
      type: "send",
      id: "user-over",
      text: "one more",
      ...bus,
    });
    expect(conversation.send).toHaveBeenLastCalledWith("one more", undefined);
    expect(listItems(id).some((i) => i.id === "user-over")).toBe(true);
    host.close();
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

  // Retires a worker cleanly, as after a deploy, with its tools at `digest`.
  async function retired(digest: string | null) {
    const { id, host, conversation } = await startHost("orchestrator");
    getDb()
      .prepare(`UPDATE sessions SET chat_tools_digest = ? WHERE id = ?`)
      .run(digest, id);
    await host.handle({ type: "send", id: "user-0", text: "work" });
    await host.handle({ type: "retire" });
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
    return {
      id,
      row: () =>
        getDb()
          .prepare(`SELECT * FROM sessions WHERE id = ?`)
          .get(id) as Session,
    };
  }

  it("says nothing when the tools didn't change, or the role has none of AgentOS's", async () => {
    const { ChatHost } = await import("./host");
    for (const digest of ["v1", undefined]) {
      const { row } = await retired("v1");
      current = fakeConversation();
      const next = new ChatHost(row(), () => {}, { toolsDigest: digest });
      await next.handle({ type: "send", id: "user-1", text: "an event" });
      expect(current.send).toHaveBeenLastCalledWith("an event", undefined);
      expect(row().chat_restarted).toBe(0);
      expect(row().chat_tools_digest).toBe(digest ?? null);
      next.close();
    }
  });

  it("after a clean retire, the next worker tells the agent once, ahead of its next message", async () => {
    const { RESTARTED_NOTE, ChatHost } = await import("./host");
    const tools = { toolsDigest: "v2" };
    const { id, host, conversation } = await startHost("orchestrator");
    await host.handle({ type: "send", id: "user-0", text: "work" });
    await host.handle({ type: "retire" });
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push({ type: "suggestion", text: "next" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
    const row = () =>
      getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;
    // Kept in the database, so a server restart in between doesn't lose it,
    // nor a next worker that goes before sending anything.
    current = fakeConversation();
    new ChatHost(row(), () => {}, tools).close();
    current = fakeConversation();
    const next = new ChatHost(row(), () => {}, tools);
    await next.handle({ type: "send", id: "user-1", text: "an event" });
    expect(current.send).toHaveBeenLastCalledWith(
      `${RESTARTED_NOTE}\n\nan event`,
      undefined
    );
    // The chat shows what was sent, not the note.
    expect(listItems(id).find((i) => i.id === "user-1")).toMatchObject({
      text: "an event",
    });
    current.events.push({ type: "state", state: "idle" });
    await tick();
    await next.handle({ type: "send", id: "user-2", text: "another" });
    expect(current.send).toHaveBeenLastCalledWith("another", undefined);
    // The worker keeps the tools it told the agent about, for the next one.
    expect(row().chat_tools_digest).toBe("v2");
    next.close();
    current = fakeConversation();
    const later = new ChatHost(row(), () => {}, tools);
    await later.handle({ type: "send", id: "user-3", text: "later" });
    expect(current.send).toHaveBeenLastCalledWith("later", undefined);
    later.close();
  });

  it("a worker that goes any other way (a crash, a stop) leaves no note", async () => {
    const { ChatHost } = await import("./host");
    const { id, host } = await startHost("orchestrator");
    await host.handle({ type: "send", id: "user-0", text: "work" });
    await host.handle({ type: "retire" });
    host.close();
    current = fakeConversation();
    const next = new ChatHost(
      getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session,
      () => {}
    );
    await next.handle({ type: "send", id: "user-1", text: "hello" });
    expect(current.send).toHaveBeenLastCalledWith("hello", undefined);
    next.close();
  });
});

describe("ChatHost fresh start at the context threshold", () => {
  const bus = {
    from: "agentos",
    origin: { kind: "event" as const, label: "AgentOS" },
  };
  const at = (atTokens: number): RoleExtras => ({
    refresh: { atTokens, role: "orchestrator" },
  });
  const context = (usedTokens: number): DriverEvent => ({
    type: "context",
    context: {
      usedTokens,
      maxTokens: 1_000_000,
      percentage: Math.round(usedTokens / 10_000),
      categories: [],
      at: Date.now(),
    },
  });
  const row = (id: string) =>
    getDb()
      .prepare(
        `SELECT claude_session_id, chat_refreshed, chat_context, chat_restarted FROM sessions WHERE id = ?`
      )
      .get(id) as {
      claude_session_id: string | null;
      chat_refreshed: number;
      chat_context: string | null;
      chat_restarted: number;
    };

  it("crossing it mid-turn ends the conversation once, at the turn's end, keeping what queued", async () => {
    const { id, host, conversation } = await startHost(
      "orchestrator",
      { resumeId: "conv-old" },
      undefined,
      at(200_000)
    );
    await host.handle({ type: "send", id: "user-1", text: "work" });
    conversation.events.push(context(210_000));
    await tick();
    // Mid-turn: nothing ends yet, and an event waits for the next worker.
    expect(conversation.close).not.toHaveBeenCalled();
    await host.handle({ type: "send", id: "user-2", text: "event", ...bus });
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-2"]);
    conversation.events.push(context(230_000));
    conversation.events.push({ type: "state", state: "idle" });
    // The agent naming its conversation again as it goes can't bring the
    // ended one back.
    conversation.events.push({ type: "resume_id", id: "conv-old" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
    expect(conversation.send).toHaveBeenCalledTimes(1);
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-2"]);
    const saved = row(id);
    expect(saved.claude_session_id).toBeNull();
    expect(saved.chat_context).toBeNull();
    expect(saved.chat_refreshed).toBe(210_000);
    expect(saved.chat_restarted).toBe(0);
    // The worker after it, from that row, starts a new conversation.
    const { ChatHost } = await import("./host");
    current = fakeConversation();
    const next = new ChatHost(
      getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session,
      () => {},
      at(200_000)
    );
    expect(started?.resumeId).toBeNull();
    next.close();
    expect(
      listItems(id).filter(
        (i) => i.kind === "note" && i.text.includes("fresh conversation")
      )
    ).toHaveLength(1);
    await host.done;
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("idle when it's crossed, goes at once without waiting for a guess", async () => {
    const { host, conversation } = await startHost(
      "orchestrator",
      { resumeId: "conv-old" },
      undefined,
      at(200_000)
    );
    await host.handle({ type: "send", id: "user-1", text: "work" });
    conversation.events.push({ type: "state", state: "idle" });
    conversation.events.push(context(200_000));
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("a conversation it started new goes only once it has grown past what the brief costs", async () => {
    const { host, conversation } = await startHost(
      "orchestrator",
      undefined,
      undefined,
      at(50_000)
    );
    // The brief alone is near the threshold: the first turns don't end it.
    await host.handle({ type: "send", id: "user-1", text: "event" });
    conversation.events.push(context(48_000));
    conversation.events.push({ type: "state", state: "idle" });
    await host.handle({ type: "send", id: "user-2", text: "event" });
    conversation.events.push(context(55_000));
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).not.toHaveBeenCalled();
    // A quarter of the threshold past its first reading, it does.
    await host.handle({ type: "send", id: "user-3", text: "event" });
    conversation.events.push(context(60_500));
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
  });

  it("under the threshold, or with none, carries on", async () => {
    for (const extras of [at(200_000), {}, at(0)]) {
      const { host, conversation } = await startHost(
        "orchestrator",
        undefined,
        undefined,
        extras
      );
      await host.handle({ type: "send", id: "user-1", text: "work" });
      conversation.events.push(
        context(extras.refresh?.atTokens ? 199_999 : 900_000)
      );
      conversation.events.push({ type: "state", state: "idle" });
      await tick();
      expect(conversation.close).not.toHaveBeenCalled();
      host.close();
    }
  });

  it("the next worker starts a new conversation and says why, once", async () => {
    const { id, host, conversation } = await startHost(
      "orchestrator",
      undefined,
      (id) =>
        getDb()
          .prepare(`UPDATE sessions SET chat_refreshed = 210000 WHERE id = ?`)
          .run(id),
      at(200_000)
    );
    expect(started?.resumeId).toBeNull();
    await host.handle({ type: "send", id: "user-1", text: "an event" });
    const first = (conversation.send.mock.calls[0] as unknown[])[0] as string;
    expect(first).toMatch(
      /^\(AgentOS started you on a fresh conversation: the last one passed 210k tokens of context\. Your brief and "Where things stand" are current/
    );
    expect(first.endsWith("\n\nan event")).toBe(true);
    // The chat shows the message as sent, without the note.
    expect(listItems(id).find((i) => i.id === "user-1")).toMatchObject({
      text: "an event",
    });
    expect(row(id).chat_refreshed).toBe(0);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({ type: "send", id: "user-2", text: "next" });
    expect((conversation.send.mock.calls[1] as unknown[])[0]).toBe("next");
    host.close();
  });
});

describe("ChatHost reports a compaction in progress", () => {
  const compactingEvents = (emitted: unknown[]) =>
    (emitted as { type: string; compacting?: unknown }[]).flatMap((e) =>
      e.type === "compacting" ? [e.compacting] : []
    );
  const compactedItem = {
    type: "item" as const,
    item: { id: "c1", kind: "compacted" as const, createdAt: 1 },
  };

  it("starts with the agent's signal, takes the size from the last measure, and ends on the compacted line", async () => {
    const { host, conversation, emitted } = await startHost("agent");
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({
      type: "context",
      context: {
        usedTokens: 151_000,
        maxTokens: 1_000_000,
        percentage: 15,
        categories: [],
        at: Date.now(),
      },
    });
    await tick();
    conversation.events.push({ type: "compacting", active: true });
    await tick();
    expect(host.state).toBe("running");
    expect(host.compactingNow).toMatchObject({ before: 151_000 });
    // Said twice, it is told once.
    conversation.events.push({ type: "compacting", active: true });
    await tick();
    expect(compactingEvents(emitted)).toHaveLength(1);
    conversation.events.push(compactedItem);
    await tick();
    expect(host.compactingNow).toBeNull();
    expect(compactingEvents(emitted)).toEqual([
      expect.objectContaining({ before: 151_000 }),
      null,
    ]);
    // The turn goes on after it.
    expect(host.state).toBe("running");
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.state).toBe("idle");
    host.close();
  });

  it("ends when the agent says so, even with no compacted line (a failed one)", async () => {
    const { host, conversation } = await startHost("agent");
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "compacting", active: true });
    await tick();
    expect(host.compactingNow).not.toBeNull();
    conversation.events.push({ type: "compacting", active: false });
    await tick();
    expect(host.compactingNow).toBeNull();
    expect(host.state).toBe("running");
    host.close();
  });

  it.each(["idle", "error"] as const)(
    "is cleared when the turn goes %s mid-compaction",
    async (state) => {
      const { host, conversation, emitted } = await startHost("agent");
      conversation.events.push({ type: "turn_start" });
      conversation.events.push({ type: "compacting", active: true });
      await tick();
      expect(host.compactingNow).not.toBeNull();
      conversation.events.push({ type: "state", state });
      await tick();
      expect(host.compactingNow).toBeNull();
      expect(compactingEvents(emitted).at(-1)).toBeNull();
      host.close();
    }
  );

  it("is cleared when the host closes mid-compaction", async () => {
    const { host, conversation, emitted } = await startHost("agent");
    conversation.events.push({ type: "turn_start" });
    conversation.events.push({ type: "compacting", active: true });
    await tick();
    host.close();
    expect(host.compactingNow).toBeNull();
    expect(compactingEvents(emitted).at(-1)).toBeNull();
  });

  it("a typed /compact shows as compacting before the agent says anything", async () => {
    const { id, host, conversation } = await startHost("agent");
    await host.handle({
      type: "send",
      id: "m1",
      text: "/compact keep the plan",
      from: "saad",
      origin: { kind: "event", label: "AgentOS" },
    });
    expect(listQueue(id)).toEqual([]);
    expect(host.compactingNow).not.toBeNull();
    conversation.events.push(compactedItem);
    await tick();
    expect(host.compactingNow).toBeNull();
    host.close();
  });
});

describe("ChatHost compacts a stale chat before a message", () => {
  const HOUR = 60 * 60_000;
  const bus = {
    from: "agentos",
    origin: { kind: "event" as const, label: "AgentOS" },
  };
  // A conversation that last ended `idleMs` ago with `usedTokens` of
  // context, written with a 1h cache (or none said).
  const staleChat = (
    idleMs: number,
    usedTokens: number,
    cacheTtlMs = HOUR,
    role = "agent"
  ) =>
    startHost(role, { resumeId: "conv-1" }, (id) =>
      getDb()
        .prepare(`UPDATE sessions SET chat_context = ? WHERE id = ?`)
        .run(
          JSON.stringify({
            usedTokens,
            maxTokens: 1_000_000,
            percentage: 40,
            categories: [],
            at: Date.now() - idleMs,
            cacheTtlMs,
          }),
          id
        )
    );
  const compactions = (id: string) =>
    getDb()
      .prepare(
        `SELECT trigger, phase, before_tokens, after_tokens FROM chat_compactions WHERE session_id = ? ORDER BY id`
      )
      .all(id);
  const sentTexts = (c: { send: { mock: { calls: unknown[][] } } }) =>
    c.send.mock.calls.map((call) => call[0]);

  it("auto: compacts first, then sends the message, with one line saying before and after", async () => {
    const { id, host, conversation, emitted } = await staleChat(
      HOUR + 60_000,
      412_000
    );
    await host.handle({
      type: "send",
      id: "m1",
      text: "continue",
      ...bus,
      compact: "auto",
    });
    // Only the compaction went in; the message waits first in line.
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD]);
    expect(listQueue(id).map((m) => m.id)).toEqual(["m1"]);
    expect(host.state).toBe("running");
    expect(emitted.some((e) => e.type === "queue")).toBe(true);
    expect(host.compactingNow).toMatchObject({ before: 412_000 });
    // What the CLI prints for /compact stays out of the chat.
    conversation.events.push({
      type: "item",
      item: {
        id: "c1",
        kind: "compacted",
        trigger: "manual",
        before: 412_000,
        createdAt: 2,
      },
    });
    conversation.events.push({
      type: "item",
      item: {
        id: "out-1",
        kind: "command_output",
        text: "Compacted",
        createdAt: 1,
      },
    });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(host.compactingNow).toBeNull();
    // The compaction's end sends the message.
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD, "continue"]);
    expect(listQueue(id)).toEqual([]);
    // The measure after the compaction fills in the size after.
    conversation.events.push({
      type: "context",
      context: {
        usedTokens: 38_000,
        maxTokens: 1_000_000,
        percentage: 4,
        categories: [],
        at: Date.now(),
        cacheTtlMs: HOUR,
      },
    });
    await tick();
    const items = listItems(id);
    expect(items.some((i) => i.kind === "command_output")).toBe(false);
    expect(items.find((i) => i.id === "c1")).toMatchObject({
      kind: "compacted",
      before: 412_000,
      after: 38_000,
      idleMs: expect.any(Number),
    });
    // Its line comes before the message it went ahead of.
    const order = items.map((i) => i.id);
    expect(order.indexOf("c1")).toBeLessThan(order.indexOf("m1"));
    // Kept for the usage history, once, with the size after.
    expect(compactions(id)).toEqual([
      {
        trigger: "stale",
        phase: "between_turns",
        before_tokens: 412_000,
        after_tokens: 38_000,
      },
    ]);
    // The agent compacting itself at its window is kept too.
    conversation.events.push({
      type: "item",
      item: {
        id: "c2",
        kind: "compacted",
        trigger: "auto",
        before: 151_000,
        createdAt: 3,
      },
    });
    await tick();
    expect(compactions(id).at(-1)).toEqual({
      trigger: "auto",
      phase: "mid_turn",
      before_tokens: 151_000,
      after_tokens: null,
    });
    host.close();
  });

  it("auto: a chat over the threshold inside its cache lifetime is compacted too, with no idle on its line", async () => {
    const { id, host, conversation } = await staleChat(HOUR - 60_000, 412_000);
    await host.handle({
      type: "send",
      id: "m1",
      text: "continue",
      ...bus,
      compact: "auto",
    });
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD]);
    conversation.events.push({
      type: "item",
      item: { id: "c1", kind: "compacted", trigger: "manual", createdAt: 1 },
    });
    await tick();
    const line = listItems(id).find((i) => i.id === "c1");
    expect(line).toMatchObject({ before: 412_000 });
    expect(line && "idleMs" in line && line.idleMs).toBeFalsy();
    host.close();
  });

  it("auto: an orchestrator over the threshold with a warm cache is sent to as is", async () => {
    const { host, conversation } = await staleChat(
      HOUR - 60_000,
      412_000,
      HOUR,
      "orchestrator"
    );
    await host.handle({
      type: "send",
      id: "m1",
      text: "continue",
      ...bus,
      compact: "auto",
    });
    expect(sentTexts(conversation)).toEqual(["continue"]);
    host.close();
  });

  it("auto: a short conversation is sent to as is, however long idle", async () => {
    const { host, conversation } = await staleChat(5 * HOUR, 120_000);
    await host.handle({
      type: "send",
      id: "m1",
      text: "continue",
      ...bus,
      compact: "auto",
    });
    expect(sentTexts(conversation)).toEqual(["continue"]);
    host.close();
  });

  it("never compacts mid-turn", async () => {
    const { host, conversation } = await staleChat(2 * HOUR, 412_000);
    await host.handle({ type: "send", id: "m0", text: "work" });
    expect(host.state).toBe("running");
    await host.handle({
      type: "send",
      id: "m1",
      text: "event",
      ...bus,
      compact: "auto",
    });
    await host.handle({
      type: "send",
      id: "m2",
      text: "typed",
      compact: "yes",
      queue: true,
    });
    expect(sentTexts(conversation)).not.toContain(COMPACT_CMD);
    host.close();
  });

  it("without a compact flag, a stale chat is sent to as is", async () => {
    const { host, conversation } = await staleChat(2 * HOUR, 412_000);
    await host.handle({ type: "send", id: "m1", text: "continue", ...bus });
    expect(sentTexts(conversation)).toEqual(["continue"]);
    host.close();
  });

  it("an agent that never said which cache it uses is never compacted", async () => {
    const { host, conversation } = await staleChat(2 * HOUR, 412_000, 0);
    await host.handle({
      type: "send",
      id: "m1",
      text: "continue",
      ...bus,
      compact: "auto",
    });
    expect(sentTexts(conversation)).toEqual(["continue"]);
    host.close();
  });

  it("yes (the composer's chip): compacts on the reader's word", async () => {
    const { host, conversation } = await staleChat(2 * HOUR, 412_000);
    await host.handle({
      type: "send",
      id: "m1",
      text: "go on",
      compact: "yes",
      queue: true,
    });
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD]);
    host.close();
  });

  it("what's sent during the compaction waits behind the message it's for", async () => {
    const { id, host, conversation } = await staleChat(2 * HOUR, 412_000);
    await host.handle({
      type: "send",
      id: "m1",
      text: "first",
      ...bus,
      compact: "auto",
    });
    await host.handle({
      type: "send",
      id: "m2",
      text: "second",
      ...bus,
      compact: "auto",
    });
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD]);
    expect(listQueue(id).map((m) => m.id)).toEqual(["m1", "m2"]);
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD, "first"]);
    host.close();
  });

  it("a failed compaction still sends the message, and says why it failed", async () => {
    const { id, host, conversation } = await staleChat(2 * HOUR, 412_000);
    await host.handle({
      type: "send",
      id: "m1",
      text: "continue",
      ...bus,
      compact: "auto",
    });
    conversation.events.push({
      type: "item",
      item: {
        id: "out-1",
        kind: "command_output",
        text: "Error during compaction: overloaded",
        createdAt: 1,
      },
    });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD, "continue"]);
    expect(listQueue(id)).toEqual([]);
    expect(listItems(id).find((i) => i.id === "out-1")).toMatchObject({
      text: "Error during compaction: overloaded",
    });
    // Nothing is held behind it any more.
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    await host.handle({ type: "send", id: "m2", text: "next", ...bus });
    expect(sentTexts(conversation)).toEqual([COMPACT_CMD, "continue", "next"]);
    host.close();
  });

  it("an orchestrator starts a fresh conversation instead, keeping its untrusted text out of a summary", async () => {
    const { id, host, conversation } = await staleChat(
      2 * HOUR,
      412_000,
      HOUR,
      "orchestrator"
    );
    await host.handle({
      type: "send",
      id: "m1",
      text: "[AgentOS event] ci failed",
      ...bus,
      compact: "auto",
    });
    expect(sentTexts(conversation)).not.toContain(COMPACT_CMD);
    expect(conversation.close).toHaveBeenCalledOnce();
    // The message waits for the next worker, which starts over.
    expect(listQueue(id).map((m) => m.id)).toEqual(["m1"]);
    const row = getDb()
      .prepare(
        `SELECT claude_session_id, chat_refreshed FROM sessions WHERE id = ?`
      )
      .get(id) as { claude_session_id: string | null; chat_refreshed: number };
    expect(row).toEqual({ claude_session_id: null, chat_refreshed: 412_000 });
    const note = listItems(id).find((i) => i.kind === "note");
    expect(note).toMatchObject({
      text: expect.stringMatching(
        /^Idle 2h · 412k context, past its prompt cache: the agent starts a fresh conversation with its brief and the current state from AgentOS/
      ),
    });
    // The next worker tells it why, as an orchestrator.
    const { ChatHost } = await import("./host");
    current = fakeConversation();
    const next = new ChatHost(
      getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session,
      () => {}
    );
    expect(started?.resumeId).toBeNull();
    await next.handle({ type: "drain" });
    expect(sentTexts(current)[0]).toMatch(
      /^\(AgentOS started you on a fresh conversation[^)]*"Where things stand"/
    );
    // The message that woke it goes in, behind the note, and nothing waits.
    expect(sentTexts(current)).toHaveLength(1);
    expect(sentTexts(current)[0]).toMatch(/\n\n\[AgentOS event\] ci failed$/);
    expect(listQueue(id)).toEqual([]);
    next.close();
  });
});

describe("a role's tool guard", () => {
  it("reaches the driver, and refuses to start an agent that can't run it", async () => {
    const toolGuard = vi.fn(async () => "no");
    const { host } = await startHost("orchestrator", undefined, undefined, {
      toolGuard,
    });
    expect(started?.toolGuard).toBe(toolGuard);
    host.close();
    await expect(
      startHost(
        "orchestrator",
        undefined,
        (id) =>
          getDb()
            .prepare(`UPDATE sessions SET agent_type = 'codex' WHERE id = ?`)
            .run(id),
        { toolGuard }
      )
    ).rejects.toThrow(/can't enforce this role's tools/);
  });
});

describe("ChatHost fresh start on request", () => {
  const sessionRow = (id: string) =>
    getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;
  const savedRow = (id: string) =>
    getDb()
      .prepare(
        `SELECT claude_session_id, chat_refreshed FROM sessions WHERE id = ?`
      )
      .get(id) as { claude_session_id: string | null; chat_refreshed: number };
  const notes = (id: string) =>
    listItems(id).flatMap((i) => (i.kind === "note" ? [i.text] : []));

  it("ends an idle orchestrator's conversation at once, with the usual line", async () => {
    const { id, host, conversation } = await startHost("orchestrator", {
      resumeId: "conv-old",
    });
    await host.handle({ type: "fresh" });
    await host.done;
    expect(conversation.close).toHaveBeenCalledOnce();
    expect(savedRow(id)).toEqual({
      claude_session_id: null,
      chat_refreshed: -1,
    });
    expect(notes(id).filter((t) => t.startsWith("Fresh start"))).toHaveLength(
      1
    );
  });

  it("waits for the turn boundary mid-turn, saying so, and keeps what queued", async () => {
    const { id, host, conversation } = await startHost("orchestrator", {
      resumeId: "conv-old",
    });
    await host.handle({ type: "send", id: "user-1", text: "work" });
    await host.handle({ type: "fresh" });
    expect(conversation.close).not.toHaveBeenCalled();
    expect(savedRow(id).claude_session_id).toBe("conv-old");
    expect(notes(id)).toContain("Starts fresh after this turn");
    // Asking twice doesn't say it twice.
    await host.handle({ type: "fresh" });
    expect(
      notes(id).filter((t) => t === "Starts fresh after this turn")
    ).toHaveLength(1);
    await host.handle({
      type: "send",
      id: "user-2",
      text: "event",
      from: "agentos",
      origin: { kind: "event", label: "AgentOS" },
    });
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
    expect(conversation.close).toHaveBeenCalledOnce();
    expect(savedRow(id).claude_session_id).toBeNull();
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-2"]);
    await host.done;
  });

  it("relaunches with the permissions and brief the server has now", async () => {
    const { ORCHESTRATOR_PERMISSIONS } =
      await import("../../orchestrator/tool-names");
    const { roleExtras } = await import("./extras");
    const { ChatHost } = await import("./host");
    const { seedWorkspace } = await import("../../orchestrator/testing");
    const ws = seedWorkspace();
    const first = await startHost("orchestrator", { resumeId: "conv-old" });
    getDb()
      .prepare(
        `UPDATE sessions SET workspace_id = ?, project_id = ?, chat_access = 'full' WHERE id = ?`
      )
      .run(ws.workspace.id, ws.app.id, first.id);
    await first.host.handle({ type: "fresh" });
    await first.host.done;

    // A deploy changed the permissions and the saved access since it began.
    const marker = "Bash(echo fresh-test:*)";
    ORCHESTRATOR_PERMISSIONS.allowedTools.push(marker);
    getDb()
      .prepare(`UPDATE sessions SET chat_access = 'read' WHERE id = ?`)
      .run(first.id);
    try {
      current = fakeConversation();
      const row = sessionRow(first.id);
      const next = new ChatHost(row, () => {}, await roleExtras(row));
      expect(started?.resumeId).toBeNull();
      expect(started?.allowedTools).toContain(marker);
      expect(started?.access).toBe("read");
      next.close();
    } finally {
      ORCHESTRATOR_PERMISSIONS.allowedTools.pop();
    }
  });
});
