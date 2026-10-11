import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../db";

// Restack stops an item's agent before rewriting its worktree, whichever
// way the agent runs, and says so when it couldn't.
const calls: string[] = [];
let chatResult: unknown;
vi.mock("../chat/stop", () => ({
  stopChatTurn: async (id: string, o: { graceMs: number }) => {
    calls.push(`stop ${id} ${o.graceMs}`);
    return chatResult;
  },
}));
vi.mock("../tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks/gh")>()),
  run: async (cmd: string, args: string[]) =>
    void calls.push(`${cmd} ${args.join(" ")}`),
}));

const { interruptAgent, CHAT_STOP_WAIT_MS } = await import("./restack");
const session = (view: string) =>
  ({ id: "s1", tmux_name: "claude-s1", view }) as Session;
const noWait = async () => {};

beforeEach(() => {
  calls.length = 0;
  chatResult = { stopped: true, killed: false };
});

describe("interrupting a stack item's agent", () => {
  it("a chat goes through the one stop path, with the restack wait", async () => {
    expect(await interruptAgent(session("chat"), noWait)).toBe(true);
    expect(calls).toEqual([`stop s1 ${CHAT_STOP_WAIT_MS}`]);
  });

  it("a chat whose agent had to be ended is stopped all the same", async () => {
    chatResult = { stopped: true, killed: true };
    expect(await interruptAgent(session("chat"), noWait)).toBe(true);
  });

  it("a chat that can't be shown to have stopped is not", async () => {
    chatResult = { stopped: false, reason: "gone" };
    expect(await interruptAgent(session("chat"), noWait)).toBe(false);
  });

  it("a terminal: Escape to its tmux session", async () => {
    expect(await interruptAgent(session("terminal"), noWait)).toBe(true);
    expect(calls).toEqual(["tmux send-keys -t =claude-s1: Escape"]);
  });
});
