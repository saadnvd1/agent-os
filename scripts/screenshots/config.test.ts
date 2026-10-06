import { describe, expect, it } from "vitest";
import { demoTmuxArgs, ROOT, TMUX_SOCKET } from "./config";

describe("demo tmux", () => {
  it("always names the demo socket, so it can never reach the real server", () => {
    const args = demoTmuxArgs(["kill-server"]);
    expect(args.slice(0, 2)).toEqual(["-S", TMUX_SOCKET]);
    expect(TMUX_SOCKET.startsWith(ROOT)).toBe(true);
    expect(TMUX_SOCKET).not.toMatch(/^\/(private\/)?tmp\/tmux-/);
  });
});
