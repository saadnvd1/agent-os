import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Runs installer shell under macOS's /bin/bash 3.2 with `set -euo pipefail`,
// a fake $HOME, and a PATH of only fake tools plus the system's /usr/bin:/bin
// (no agent CLI, no Homebrew).
export const LIB = import.meta.dirname;
export const BASH = "/bin/bash";

export function fakeTool(dir: string, name: string, body: string) {
  mkdirSync(join(dir, "bin"), { recursive: true });
  const p = join(dir, "bin", name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

export function runInstaller(
  dir: string,
  command: string,
  opts: { input?: string; env?: Record<string, string> } = {}
) {
  const preamble = [
    `source "${LIB}/common.sh"`,
    `source "${LIB}/prerequisites.sh"`,
    `source "${LIB}/ai-clis.sh"`,
    `source "${LIB}/commands.sh"`,
    `BOLD=""; OS=macos WSL=0 PORT=3011 AGENT_OS_HOME="${dir}/home/.agent-os"`,
    `REPO_DIR="$AGENT_OS_HOME/repo" PID_FILE="$AGENT_OS_HOME/agent-os.pid" LOG_FILE="$AGENT_OS_HOME/agent-os.log"`,
    `SCRIPT_DIR="${LIB}/.."`,
  ].join("; ");
  return spawnSync(
    BASH,
    ["-euo", "pipefail", "-c", `${preamble}; ${command}`],
    {
      cwd: dir,
      encoding: "utf8",
      input: opts.input ?? "",
      env: {
        PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
        HOME: join(dir, "home"),
        NODE_ENV: "test",
        ...opts.env,
      },
    }
  );
}
