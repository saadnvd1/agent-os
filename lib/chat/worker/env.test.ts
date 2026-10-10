import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adoptServerEnv } from "./env";
import { envPath } from "./protocol";

let home = "";
beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-worker-env-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterAll(() => vi.restoreAllMocks());

function handOver(sessionId: string, env: Record<string, string>) {
  const file = envPath(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(env), { mode: 0o600 });
  return file;
}

const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("adoptServerEnv", () => {
  it("takes the server's environment, and none of tmux's", () => {
    const file = handOver("s-1", {
      PATH: "/server/bin",
      // A server started from a tmux shell hands its own over too.
      TMUX: "/tmp/tmux-1/default,1,0",
      TMUX_PANE: "%1",
    });
    // The pane the worker runs in exports the chat-worker server's socket.
    const env: Record<string, string | undefined> = {
      TMUX: "/tmp/tmux-1/default,2,5",
      TMUX_PANE: "%5",
    };
    adoptServerEnv("s-1", env);
    expect(env).toEqual({ PATH: "/server/bin" });
    expect(fs.existsSync(file)).toBe(false);
  });

  // The real thing: a worker in a tmux pane (on a private socket), and a
  // shell it starts, as an agent's Bash tool does.
  it.runIf(hasTmux)(
    "leaves a shell the worker starts no tmux server to reach",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-worker-tmux-"));
      const sock = path.join(dir, "sock");
      const out = path.join(dir, "out");
      const script = path.join(dir, "worker.mts");
      fs.writeFileSync(
        script,
        `import { execFileSync } from "child_process";
import fs from "fs";
fs.writeFileSync(${JSON.stringify(`${out}.pane`)}, process.env.TMUX ?? "none");
const { adoptServerEnv } = await import(${JSON.stringify(path.join(__dirname, "env.ts"))});
adoptServerEnv("none-handed-over");
fs.writeFileSync(${JSON.stringify(out)}, execFileSync("sh", ["-c", 'echo "\${TMUX:-none} \${TMUX_PANE:-none}"']).toString());
`
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
      };
      delete env.TMUX;
      delete env.TMUX_PANE;
      try {
        execFileSync(
          "tmux",
          [
            "-S",
            sock,
            "new-session",
            "-d",
            `${process.execPath} --import tsx ${script}`,
          ],
          { env, cwd: process.cwd() }
        );
        const deadline = Date.now() + 15_000;
        while (!fs.existsSync(out) && Date.now() < deadline)
          execFileSync("sleep", ["0.1"]);
        // The pane did point it at this tmux server; its shells don't.
        expect(fs.readFileSync(`${out}.pane`, "utf8")).toContain(sock);
        expect(fs.readFileSync(out, "utf8").trim()).toBe("none none");
      } finally {
        try {
          execFileSync("tmux", ["-S", sock, "kill-server"], {
            env,
            stdio: "ignore",
          });
        } catch {
          // Already gone with its only session.
        }
      }
    },
    20_000
  );
});
