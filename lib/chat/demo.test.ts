import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { ChatServerMessage, DriverEvent } from "./events";
import { DEMO_REPLY, demoConversation } from "./drivers/demo";
import { chatDriverFor } from "./drivers";
import {
  DEMO_CHAT_READS,
  MAX_SENDS,
  handleDemoChat,
  sendDemoChat,
  resetDemoChat,
  setDemoReplyStep,
} from "./demo";
import { DEMO_VISITOR_TEXT } from "../security/demo";
import type { ChatClientMessage } from "./events";
import { registry } from "./registry";
import { listItems } from "./store";
import { sendChat } from "./runner";

const connectWorker = vi.hoisted(() => vi.fn());
vi.mock("./worker/client", async (original) => ({
  ...(await original<typeof import("./worker/client")>()),
  connectWorker,
}));

function newSession(): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'demo', ?, '~/code/a')`
  ).run(id, `claude-${id}`);
  return id;
}

function watch(id: string): ChatServerMessage[] {
  const seen: ChatServerMessage[] = [];
  registry.listeners.set(id, new Set([(m) => seen.push(m)]));
  return seen;
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++)
    await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

beforeEach(() => {
  vi.stubEnv("AGENTOS_DEMO", "1");
  setDemoReplyStep(0);
});
afterEach(() => vi.unstubAllEnvs());

describe("demo chat driver", () => {
  it("streams the canned reply and ends the turn", async () => {
    const c = demoConversation(0);
    c.send("hello");
    const events: DriverEvent[] = [];
    for await (const e of c.events) {
      events.push(e);
      if (e.type === "state" && e.state === "idle") break;
    }
    const streamed = events
      .filter((e) => e.type === "delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(streamed).toBe(DEMO_REPLY);
    const items = events.flatMap((e) => (e.type === "item" ? [e.item] : []));
    expect(items.at(-2)).toMatchObject({ kind: "assistant", text: DEMO_REPLY });
    expect(items.at(-1)?.kind).toBe("turn_end");
  });

  it("is the only driver a demo has, for chat agents only", () => {
    expect(chatDriverFor("claude")?.id).toBe("demo");
    expect(chatDriverFor("codex")?.id).toBe("demo");
    expect(chatDriverFor("not-an-agent")).toBeNull();
    vi.stubEnv("AGENTOS_DEMO", "");
    expect(chatDriverFor("claude")?.id).toBe("claude");
  });
});

describe("demo chat", () => {
  it("stores the message and the reply, and watchers see it stream", async () => {
    const id = newSession();
    const seen = watch(id);
    sendDemoChat(id, "fix the flaky test");
    await until(() => listItems(id).some((i) => i.kind === "turn_end"));
    const kinds = listItems(id).map((i) => i.kind);
    expect(kinds).toEqual(["user", "assistant", "turn_end"]);
    // Other visitors read this session: the visitor's own words aren't kept.
    expect(listItems(id)[0]).toMatchObject({
      kind: "user",
      text: DEMO_VISITOR_TEXT,
    });
    expect(JSON.stringify(listItems(id))).not.toContain("flaky");
    expect(listItems(id)[1]).toMatchObject({ text: DEMO_REPLY });
    expect(seen.some((m) => m.type === "delta")).toBe(true);
    expect(seen.at(-1)).toEqual({ type: "state", state: "idle" });
    expect(connectWorker).not.toHaveBeenCalled();
  });

  it("answers only history, tool bodies and task output from storage", () => {
    expect([...DEMO_CHAT_READS].sort()).toEqual([
      "history",
      "task_output",
      "tool_body",
    ]);
  });

  it("refuses every other message a chat socket can send", () => {
    const id = newSession();
    const others: ChatClientMessage[] = [
      { type: "queue_edit", id: "q", text: "x" },
      { type: "queue_move", id: "q", by: 1 },
      { type: "queue_delete", id: "q" },
      { type: "queue_send_now", id: "q" },
      { type: "set_model", model: "opus" },
      { type: "set_access", access: "full" },
      { type: "set_plan", plan: true },
      { type: "carry_plan", id: "plan-1" },
      { type: "respond", id: "a", decision: "allow" },
      { type: "undo", from: "user-1" },
      { type: "stop_task", taskId: "t" },
    ];
    const replies: ChatServerMessage[] = [];
    for (const msg of others) handleDemoChat(id, msg, (m) => replies.push(m));
    expect(replies).toHaveLength(others.length);
    for (const r of replies)
      expect(r).toMatchObject({ type: "item", item: { kind: "error" } });
    expect(listItems(id)).toEqual([]);
  });

  it("stops taking messages for a session after the cap", async () => {
    const id = newSession();
    for (let i = 0; i < MAX_SENDS; i++) sendDemoChat(id, `message ${i}`);
    expect(() => sendDemoChat(id, "one more")).toThrow(
      /Not available in the demo/
    );
    await until(
      () =>
        listItems(id).filter((i) => i.kind === "turn_end").length === MAX_SENDS
    );
    expect(listItems(id).filter((i) => i.kind === "user")).toHaveLength(
      MAX_SENDS
    );
  });

  it("a chat socket for a session that doesn't exist throws to its caller, never later", async () => {
    // server.ts closes the socket on the throw; an unhandled rejection
    // afterwards would take the process down.
    const { watchChat } = await import("./runner");
    const { sendCapabilities } = await import("./settings");
    expect(() => watchChat("nope", () => {})).toThrow(/Session not found/);
    await expect(sendCapabilities("nope", () => {})).resolves.toBeUndefined();
  });

  it("refuses a session that doesn't exist", () => {
    expect(() => sendDemoChat("nope", "hi")).toThrow(/Session not found/);
  });

  it("a reset stops a reply mid-stream: watchers see idle, nothing more is saved", async () => {
    setDemoReplyStep(20);
    const id = newSession();
    const seen = watch(id);
    sendDemoChat(id, "hello");
    await until(() => seen.some((m) => m.type === "delta"));
    resetDemoChat();
    expect(seen.at(-1)).toEqual({ type: "state", state: "idle" });
    const count = seen.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toHaveLength(count);
    expect(listItems(id).map((i) => i.kind)).toEqual(["user"]);
  });

  it("starts over after a re-seed: send counts and conversations reset", () => {
    const id = newSession();
    for (let i = 0; i < MAX_SENDS; i++) sendDemoChat(id, `m${i}`);
    expect(() => sendDemoChat(id, "more")).toThrow();
    resetDemoChat();
    expect(() => sendDemoChat(id, "again")).not.toThrow();
  });

  it("never starts a worker, even through the real send path", async () => {
    const id = newSession();
    await expect(sendChat(id, { text: "hi" })).rejects.toThrow(/demo/);
    expect(connectWorker).not.toHaveBeenCalled();
  });
});
