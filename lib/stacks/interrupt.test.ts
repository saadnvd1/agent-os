import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../db";

// Restack stops an item's agent before rewriting its worktree, whichever
// way the agent runs, and says so when it couldn't.
const calls: string[] = [];
let states: (string | null | Error)[] = [];
vi.mock("../chat/runner", () => ({
  interruptChat: async (id: string) => void calls.push(`interrupt ${id}`),
  chatStateNow: async () => {
    calls.push("state");
    const s = states.length > 1 ? states.shift() : states[0];
    if (s instanceof Error) throw s;
    return s ?? null;
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
  states = [];
});

describe("interrupting a stack item's agent", () => {
  it("a chat mid-turn: asked first (attaching a worker from before a restart), interrupted, waited out", async () => {
    states = ["running", "running", "idle"];
    const wait = vi.fn(noWait);
    expect(await interruptAgent(session("chat"), wait)).toBe(true);
    expect(calls.slice(0, 2)).toEqual(["state", "interrupt s1"]);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("a chat between turns, or with no worker: nothing to stop", async () => {
    states = ["idle"];
    expect(await interruptAgent(session("chat"), noWait)).toBe(true);
    states = [null];
    expect(await interruptAgent(session("chat"), noWait)).toBe(true);
    expect(calls).not.toContain("interrupt s1");
  });

  it.each([
    ["won't stop", "running"],
    ["waits on an approval", "waiting"],
    ["can't be reached", new Error("gone")],
  ])("a chat that %s: not stopped, after a bounded wait", async (_w, s) => {
    states = [s];
    const wait = vi.fn(noWait);
    expect(await interruptAgent(session("chat"), wait)).toBe(false);
    expect(wait).toHaveBeenCalledTimes(CHAT_STOP_WAIT_MS / 500);
  });

  it("a terminal: Escape to its tmux session", async () => {
    expect(await interruptAgent(session("terminal"), noWait)).toBe(true);
    expect(calls).toEqual(["tmux send-keys -t =claude-s1: Escape"]);
  });
});
