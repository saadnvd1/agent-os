import { beforeEach, describe, expect, it, vi } from "vitest";

const ended = vi.hoisted(() => [] as unknown[][]);
const stopped = vi.hoisted(() => [] as string[]);
vi.mock("../tmux/end", () => ({
  endTmuxSession: async (...a: unknown[]) => {
    ended.push(a);
  },
}));
vi.mock("../chat/runner", () => ({
  stopChat: (id: string) => stopped.push(id),
}));
const released = vi.hoisted(() => [] as unknown[][]);
vi.mock("../simulator", () => ({
  releaseOnEnd: (...a: unknown[]) => released.push(a),
}));
vi.mock("../chat/worker/client", () => ({
  waitForExit: async () => {},
}));

const { endSessionAgent } = await import("./end");

beforeEach(() => {
  ended.length = 0;
  stopped.length = 0;
  released.length = 0;
});

describe("endSessionAgent", () => {
  it("stops the chat worker and ends the tmux session on its host", async () => {
    await endSessionAgent({ id: "s1", host_id: "h1", tmux_name: "claude-s1" });
    expect(stopped).toEqual(["s1"]);
    expect(ended).toEqual([["h1", "claude-s1"]]);
  });

  it("removes the task's simulator with it", async () => {
    await endSessionAgent({ id: "s1", host_id: "h1", tmux_name: "claude-s1" });
    expect(released).toEqual([["s1", { remove: true }]]);
  });
});
