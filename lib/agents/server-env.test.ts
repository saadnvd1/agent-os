import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  sessionBaseEnv,
  SERVER_ONLY_ENV,
  UNSET_SERVER_ENV,
} from "./server-env";

describe("sessionBaseEnv", () => {
  const parent = {
    NODE_ENV: "production",
    PORT: "3011",
    AGENTOS_SERVER: "live",
    AGENTOS_DEV: "1",
    AGENTOS_URL: "http://127.0.0.1:3011",
    AGENTOS_PORT: "3011",
    AGENTOS_SESSION_ID: "s1",
    HOME: "/h",
  } as unknown as NodeJS.ProcessEnv;

  it("drops every server-only variable and keeps the rest", () => {
    const env = sessionBaseEnv(parent);
    for (const k of SERVER_ONLY_ENV) expect(env).not.toHaveProperty(k);
    expect(Object.keys(env).sort()).toEqual([
      "AGENTOS_PORT",
      "AGENTOS_SESSION_ID",
      "AGENTOS_URL",
      "HOME",
    ]);
  });

  it("does not touch the parent", () => {
    sessionBaseEnv(parent);
    expect(parent.NODE_ENV).toBe("production");
  });
});

const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTmux)("a pane started the way AgentOS starts one", () => {
  const polluted = {
    NODE_ENV: "production",
    PORT: "3011",
    AGENTOS_SERVER: "live",
    AGENTOS_DEV: "1",
    AGENTOS_URL: "http://127.0.0.1:3011",
  } as unknown as NodeJS.ProcessEnv;

  function paneEnv(prewarm: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-env-"));
    const sock = path.join(dir, "t.sock");
    const out = path.join(dir, "env.txt");
    // env -u TMUX: never reach the real tmux server.
    const run = (env: NodeJS.ProcessEnv, args: string[]) =>
      execFileSync("env", ["-u", "TMUX", "tmux", "-S", sock, ...args], {
        env: { ...env, PATH: process.env.PATH },
      });
    try {
      // An existing tmux server that was itself started with them.
      if (prewarm)
        run(polluted, ["new-session", "-d", "-s", "old", "sleep 60"]);
      // What a spawn path does: tmux gets the cleaned env, and the pane
      // command clears anything the server already held.
      run(sessionBaseEnv(polluted), [
        "new-session",
        "-d",
        "-s",
        "pane",
        "-e",
        "AGENTOS_SESSION_ID=s1",
        `${UNSET_SERVER_ENV}env > ${out}.tmp && mv ${out}.tmp ${out}; sleep 1`,
      ]);
      // The pane renames the finished dump into place, so existence means
      // complete. Wait on that, not on a fixed delay: a loaded machine can
      // take seconds to start tmux and the pane shell.
      const deadline = Date.now() + 20_000;
      while (!fs.existsSync(out) && Date.now() < deadline)
        execFileSync("sleep", ["0.1"]);
      return fs.readFileSync(out, "utf8");
    } finally {
      try {
        run({} as NodeJS.ProcessEnv, ["kill-server"]);
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  for (const prewarm of [false, true])
    it(`has no server-only variables (tmux server ${prewarm ? "already polluted" : "started by AgentOS"})`, () => {
      const lines = paneEnv(prewarm).split("\n");
      for (const k of ["NODE_ENV", "PORT", "AGENTOS_SERVER", "AGENTOS_DEV"])
        expect(
          lines.some((l) => l.startsWith(`${k}=`)),
          k
        ).toBe(false);
      expect(lines).toContain("AGENTOS_SESSION_ID=s1");
    }, 30_000);
});
