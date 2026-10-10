import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The installer's WSL paths, run on any OS: `uname`, `ps` and the browser
// openers are fakes on PATH, and the kernel release is a file. Only this
// environment, so a run inside WSL isn't told it's WSL.
const LIB = join(import.meta.dirname);

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
    "bash",
    [
      "-euo",
      "pipefail",
      "-c",
      `source "${LIB}/common.sh"; source "${LIB}/commands.sh"; ${script}`,
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
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
  fake("uname", 'echo "Linux"');
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
