import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

const sendChat = vi.fn(async () => {});
vi.mock("../chat/runner", () => ({ sendChat }));
vi.mock("../status-detector", () => ({
  statusDetector: { refreshCache: async () => {}, sessionExists: () => false },
}));

function session(name: string, view: "chat" | "terminal"): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, ?, ?, '/tmp')`
    )
    .run(id, name, `claude-${id}`);
  getDb().prepare(`UPDATE sessions SET view = ? WHERE id = ?`).run(view, id);
  return id;
}

describe("sendMessage to a chat session", () => {
  beforeEach(() => sendChat.mockClear());

  it("tags another session's message as theirs, with the full line for the agent", async () => {
    const { sendMessage } = await import("./index");
    const to = session(`chat-${randomUUID().slice(0, 6)}`, "chat");
    const from = session(`Sender ${randomUUID().slice(0, 6)}`, "terminal");
    const fromName = getDb()
      .prepare(`SELECT name FROM sessions WHERE id = ?`)
      .get(from) as { name: string };
    await sendMessage({ fromId: from, to, body: "rebased, tests green" });
    expect(sendChat).toHaveBeenCalledWith(to, {
      text: expect.stringContaining("Reply with: aos send"),
      from: fromName.name,
      peer: { sessionId: from, body: "rebased, tests green" },
    });
  });

  it("leaves a message from the user untagged", async () => {
    const { sendMessage } = await import("./index");
    const to = session(`chat-${randomUUID().slice(0, 6)}`, "chat");
    await sendMessage({ fromId: null, to, body: "hello" });
    expect(sendChat).toHaveBeenCalledWith(
      to,
      expect.objectContaining({ peer: undefined })
    );
  });
});
