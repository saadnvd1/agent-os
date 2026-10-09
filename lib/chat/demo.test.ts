import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { ChatServerMessage, DriverEvent } from "./events";
import { DEMO_REPLY, demoConversation } from "./drivers/demo";
import { chatDriverFor } from "./drivers";
import { handleDemoChat, sendDemoChat } from "./demo";
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

beforeEach(() => vi.stubEnv("AGENTOS_DEMO", "1"));
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
    expect(listItems(id)[1]).toMatchObject({ text: DEMO_REPLY });
    expect(seen.some((m) => m.type === "delta")).toBe(true);
    expect(seen.at(-1)).toEqual({ type: "state", state: "idle" });
    expect(connectWorker).not.toHaveBeenCalled();
  });

  it("refuses everything else a chat socket can ask", () => {
    const id = newSession();
    const replies: ChatServerMessage[] = [];
    for (const msg of [
      { type: "undo", from: "user-1" },
      { type: "set_access", access: "full" },
      { type: "carry_plan", id: "plan-1" },
      { type: "queue_send_now", id: "q-1" },
    ] as const)
      handleDemoChat(id, msg, (m) => replies.push(m));
    expect(replies).toHaveLength(4);
    for (const r of replies)
      expect(r).toMatchObject({ type: "item", item: { kind: "error" } });
    expect(listItems(id)).toEqual([]);
  });

  it("refuses a session that doesn't exist", () => {
    expect(() => sendDemoChat("nope", "hi")).toThrow();
  });

  it("never starts a worker, even through the real send path", async () => {
    const id = newSession();
    await expect(sendChat(id, { text: "hi" })).rejects.toThrow(/demo/);
    expect(connectWorker).not.toHaveBeenCalled();
  });
});
