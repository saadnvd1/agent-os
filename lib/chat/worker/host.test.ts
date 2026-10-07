import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { getDb, type Session } from "@/lib/db";
import type { ChatConversation, ChatStartOptions } from "../driver";
import type { ChatItem, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { listItems } from "../store";
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

async function startHost(
  role = "agent",
  saved?: { resumeId?: string; usage?: object }
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
      await tick();
      expect(costs(id)).toEqual([1]);
      host.close();
    });
  });
});
