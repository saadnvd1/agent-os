import { describe, expect, it } from "vitest";
import {
  demoEnv,
  demoPath,
  demoShell,
  demoTmuxArgs,
  ROOT,
  TMUX_SOCKET,
} from "./config";

describe("demo tmux", () => {
  it("always names the demo socket, so it can never reach the real server", () => {
    const args = demoTmuxArgs(["kill-server"]);
    expect(args.slice(0, 2)).toEqual(["-S", TMUX_SOCKET]);
    expect(TMUX_SOCKET.startsWith(ROOT)).toBe(true);
    expect(TMUX_SOCKET).not.toMatch(/^\/(private\/)?tmp\/tmux-/);
  });
});

describe("demo env on any machine", () => {
  it("uses a shell that exists: zsh, else bash, else sh", () => {
    const linux = new Set(["/bin/bash", "/usr/bin/bash", "/bin/sh"]);
    expect(demoShell((p) => linux.has(String(p)))).toBe("/bin/bash");
    expect(demoShell(() => false)).toBe("/bin/sh");
    expect(demoShell((p) => String(p) === "/usr/bin/zsh")).toBe("/usr/bin/zsh");
  });

  it("puts only existing system directories on PATH", () => {
    const linux = new Set(["/usr/local/bin", "/usr/bin", "/bin"]);
    const parts = demoPath((p) => linux.has(String(p))).split(":");
    expect(parts).not.toContain("/opt/homebrew/bin");
    expect(parts.slice(-3)).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);
  });

  it("names the demo root, which demo mode requires", () => {
    const env = demoEnv();
    expect(env.AGENTOS_DEMO_ROOT).toBe(ROOT);
    expect(env.DB_PATH!.startsWith(ROOT)).toBe(true);
    expect(env.HOME!.startsWith(ROOT)).toBe(true);
  });
});
