import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../db";

// Restack stops an item's agent before rewriting its worktree, whichever
// way the agent runs.
const calls: string[] = [];
const states: (string | null)[] = [];
vi.mock("../chat/runner", () => ({
  interruptChat: async (id: string) => void calls.push(`interrupt ${id}`),
  chatStateNow: async () => states.shift() ?? "idle",
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
  states.length = 0;
});

describe("interrupting a stack item's agent", () => {
  it("a chat: through its worker, waiting until its turn has stopped", async () => {
    states.push("running", "running", "idle");
    const wait = vi.fn(noWait);
    await interruptAgent(session("chat"), wait);
    expect(calls).toEqual(["interrupt s1"]);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("a chat whose turn won't stop: gives up after a bounded wait", async () => {
    states.push(...Array(100).fill("running"));
    const wait = vi.fn(noWait);
    await interruptAgent(session("chat"), wait);
    expect(wait).toHaveBeenCalledTimes(CHAT_STOP_WAIT_MS / 500);
  });

  it("a terminal: Escape to its tmux session", async () => {
    await interruptAgent(session("terminal"), noWait);
    expect(calls).toEqual(["tmux send-keys -t =claude-s1: Escape"]);
  });
});
