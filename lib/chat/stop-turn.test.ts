import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as (string | null | Error)[],
  commands: [] as unknown[],
  stopped: [] as string[],
  exited: [] as string[],
}));
vi.mock("./runner", () => ({
  chatStateNow: async () => {
    const s = h.states.length > 1 ? h.states.shift() : h.states[0];
    if (s instanceof Error) throw s;
    return s ?? null;
  },
  stopChat: (id: string) => void h.stopped.push(id),
}));
vi.mock("./worker/client", () => ({
  waitForExit: async (id: string) => void h.exited.push(id),
}));

import { registry, type Live } from "./registry";
import { stopChatTurn } from "./stop";

const noWait = async () => {};

beforeEach(() => {
  h.states = [];
  h.commands = [];
  h.stopped = [];
  h.exited = [];
  registry.live.set("s1", {
    worker: { command: (c: unknown) => void h.commands.push(c) },
    activity: { tools: new Map(), tasks: new Set(), sends: 0 },
  } as unknown as Live);
});

describe("stopping a chat's turn", () => {
  it("interrupts a running turn hard and returns once it has stayed idle", async () => {
    h.states = ["running", "running", "idle"];
    expect(await stopChatTurn("s1", { sleep: noWait })).toEqual({
      stopped: true,
      killed: false,
    });
    expect(h.commands).toEqual([{ type: "interrupt", hard: true }]);
    expect(h.stopped).toEqual([]);
  });

  it("is not fooled by an idle that the agent's wind-down turn breaks", async () => {
    h.states = ["running", "idle", "running", "idle"];
    const out = await stopChatTurn("s1", { sleep: noWait });
    expect(out).toEqual({ stopped: true, killed: false });
  });

  it("ends the agent when the turn won't stop, keeping the session", async () => {
    h.states = ["running"];
    expect(await stopChatTurn("s1", { graceMs: 1000, sleep: noWait })).toEqual({
      stopped: true,
      killed: true,
    });
    expect(h.stopped).toEqual(["s1"]);
    expect(h.exited).toEqual(["s1"]);
  });

  it("does nothing to a chat between turns or with no worker", async () => {
    h.states = ["idle"];
    expect(await stopChatTurn("s1", { sleep: noWait })).toEqual({
      stopped: true,
      killed: false,
    });
    h.states = [null];
    await stopChatTurn("s1", { sleep: noWait });
    expect(h.commands).toEqual([]);
  });

  it("is a real error, not a quiet success, when the worker can't be reached", async () => {
    h.states = [new Error("gone")];
    const out = await stopChatTurn("s1", { sleep: noWait });
    expect(out.stopped).toBe(false);
  });

  it("leaves a new turn alone when a message is sent while the stop waits", async () => {
    h.states = ["running"];
    const live = registry.live.get("s1")!;
    const out = await stopChatTurn("s1", {
      graceMs: 1000,
      sleep: async () => {
        live.activity.sends = 1;
      },
    });
    expect(out).toEqual({ stopped: true, killed: false });
    expect(h.stopped).toEqual([]);
  });

  it("refuses, killing nothing, while the chat waits on an answer", async () => {
    h.states = ["waiting"];
    const out = await stopChatTurn("s1", { sleep: noWait });
    expect(out.stopped).toBe(false);
    expect(h.commands).toEqual([]);
    expect(h.stopped).toEqual([]);
  });
});
