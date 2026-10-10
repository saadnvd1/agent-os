import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The installer's WSL paths, run on any OS: `uname`, `ps`, the browser
// openers and the package managers are fakes, and the kernel release is a
// file. PATH is only the test's own bin (fakes plus links to a few basic
// tools) and the environment only this, so a run inside WSL sees neither
// the real wslview nor WSL_DISTRO_NAME.
const LIB = join(import.meta.dirname);
const TOOLS = ["tr", "cat", "sed", "cut", "awk", "head", "grep", "mkdir"];

let dir: string;

function fake(name: string, body: string) {
  const p = join(dir, "bin", name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

function run(
  script: string,
  osrelease: string,
  env: Record<string, string | undefined> = {}
) {
  writeFileSync(join(dir, "osrelease"), osrelease);
  return spawnSync(
    "/bin/bash",
    [
      "-euo",
      "pipefail",
      "-c",
      `source "${LIB}/common.sh"; source "${LIB}/prerequisites.sh"; source "${LIB}/commands.sh"; ${script}`,
      // $0, which `agent-os enable` writes into the unit.
      join(dir, "agent-os"),
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: join(dir, "bin"),
        HOME: dir,
        NODE_ENV: "test",
        AGENTOS_OSRELEASE_FILE: join(dir, "osrelease"),
        ...env,
      },
    }
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aos-wsl-"));
  mkdirSync(join(dir, "bin"));
  for (const tool of TOOLS) {
    const real = ["/usr/bin", "/bin"]
      .map((d) => join(d, tool))
      .find(existsSync);
    if (real) symlinkSync(real, join(dir, "bin", tool));
  }
  fake("uname", 'echo "Linux"');
  fake("realpath", 'echo "$1"');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("detect_wsl", () => {
  it("matches lib/wsl.ts on the same kernel releases", () => {
    const wsl = (rel: string, env?: Record<string, string | undefined>) =>
      run("detect_wsl", rel, env).stdout.trim();
    expect(wsl("5.15.167.4-microsoft-standard-WSL2")).toBe("2");
    expect(wsl("4.19.128-microsoft-standard")).toBe("2");
    expect(wsl("4.4.0-19041-Microsoft")).toBe("1");
    expect(wsl("6.8.0-1017-azure")).toBe("0");
    expect(wsl("6.8.0-1017-azure", { WSL_DISTRO_NAME: "Ubuntu" })).toBe("2");
  });

  it("is 0 off Linux, whatever the environment says", () => {
    fake("uname", 'echo "Darwin"');
    expect(
      run("detect_wsl", "x-microsoft-standard-WSL2", {
        WSL_DISTRO_NAME: "Ubuntu",
      }).stdout.trim()
    ).toBe("0");
  });
});

describe("open_url", () => {
  it("prefers wslview under WSL, then explorer.exe", () => {
    fake("wslview", `echo "wslview $1" > "${dir}/opened"`);
    fake("explorer.exe", `echo "explorer $1" > "${dir}/opened"; exit 1`);
    fake("xdg-open", `echo "xdg $1" > "${dir}/opened"`);
    const url = "http://localhost:3011";
    expect(run(`WSL=2 OS=debian; open_url ${url}`, "").status).toBe(0);
    expect(readFileSync(join(dir, "opened"), "utf8")).toBe(`wslview ${url}\n`);

    rmSync(join(dir, "bin", "wslview"));
    // explorer.exe exits 1 even when it worked: that isn't a failure.
    expect(run(`WSL=2 OS=debian; open_url ${url}`, "").status).toBe(0);
    expect(readFileSync(join(dir, "opened"), "utf8")).toBe(`explorer ${url}\n`);

    // Off WSL, the Windows openers aren't used even when on PATH.
    expect(run(`WSL=0 OS=debian; open_url ${url}`, "").status).toBe(0);
    expect(readFileSync(join(dir, "opened"), "utf8")).toBe(`xdg ${url}\n`);
  });
});

describe("wsl_next_steps", () => {
  const steps = (pid1: string, wsl: string) => {
    fake("ps", `echo ${pid1}`);
    return run(`WSL=${wsl} PORT=3011; wsl_next_steps`, "").stdout;
  };

  it("prints nothing off WSL", () => {
    expect(steps("systemd", "0")).toBe("");
  });

  it("explains turning systemd on when it's off", () => {
    const out = steps("init", "2");
    expect(out).toContain("http://localhost:3011");
    expect(out).toContain("systemd=true");
    expect(out).toContain("/mnt/c");
  });

  it("says enable works when systemd is on", () => {
    const out = steps("systemd", "2");
    expect(out).toContain("agent-os enable");
    expect(out).not.toContain("systemd=true");
  });

  it("flags WSL 1", () => {
    expect(steps("init", "1")).toContain("WSL 1");
  });
});

describe("agent-os enable", () => {
  const enable = (pid1: string) => {
    fake("ps", `echo ${pid1}`);
    fake("systemctl", `echo "systemctl $*" >> "${dir}/systemctl.log"`);
    mkdirSync(join(dir, "repo"));
    return run(`WSL=2 OS=debian REPO_DIR="${dir}/repo"; cmd_enable`, "");
  };
  const unit = () => join(dir, ".config/systemd/user/agent-os.service");

  it("under WSL without systemd, explains wsl.conf and writes nothing", () => {
    const r = enable("init");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("systemd=true");
    expect(existsSync(unit())).toBe(false);
    expect(existsSync(join(dir, "systemctl.log"))).toBe(false);
  });

  it("with systemd, writes and enables the user service", () => {
    const r = enable("systemd");
    expect(r.status).toBe(0);
    expect(readFileSync(unit(), "utf8")).toContain(
      `ExecStart=${join(dir, "agent-os")} start-foreground`
    );
    expect(readFileSync(join(dir, "systemctl.log"), "utf8")).toContain(
      "systemctl --user enable agent-os"
    );
  });
});

describe("installing prerequisites", () => {
  // sudo runs nothing, it only records what it was asked.
  const sudoLog = () => {
    const p = join(dir, "sudo.log");
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  beforeEach(() => fake("sudo", `echo "$*" >> "${dir}/sudo.log"`));

  it("refreshes apt once per run", () => {
    expect(run("apt_install tmux; apt_install lsof", "").status).toBe(0);
    expect(sudoLog()).toBe(
      "apt-get update\napt-get install -y tmux\napt-get install -y lsof\n"
    );
  });

  it("installs wslu only under WSL on Debian, and only when missing", () => {
    run("WSL=0 OS=debian; install_wslu", "");
    run("WSL=2 OS=redhat; install_wslu", "");
    expect(sudoLog()).toBe("");
    fake("wslview", "true");
    run("WSL=2 OS=debian; install_wslu", "");
    expect(sudoLog()).toBe("");
    rmSync(join(dir, "bin", "wslview"));
    run("WSL=2 OS=debian; install_wslu", "");
    expect(sudoLog()).toContain("apt-get install -y wslu");
  });

  it("fails, rather than reporting success, when a distro can't install what's missing", () => {
    fake("node", "echo v22.0.0");
    const r = run("WSL=0 OS=linux; check_and_install_prerequisites", "");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Still missing: tmux");
    expect(r.stdout).not.toContain("Prerequisites installed");
  });
});
