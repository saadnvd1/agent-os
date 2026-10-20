import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// `agent-os machine` on any OS: systemctl, sshd, tailscale and the server
// commands are fakes that record what they were asked.
const LIB = join(import.meta.dirname);
const TOOLS = [
  "tr",
  "cat",
  "sed",
  "head",
  "grep",
  "mkdir",
  "id",
  "mktemp",
  "cp",
  "rm",
];

let dir: string;

function fake(name: string, body: string) {
  const p = join(dir, "bin", name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}
const log = () =>
  existsSync(join(dir, "calls.log"))
    ? readFileSync(join(dir, "calls.log"), "utf8")
    : "";
const record = (name: string) =>
  fake(name, `echo "${name} $*" >> "${dir}/calls.log"`);

function machine(
  env: Record<string, string> = {},
  os = "debian",
  args = "--tailscale"
) {
  mkdirSync(join(dir, "repo"), { recursive: true });
  return spawnSync(
    "/bin/bash",
    [
      "-euo",
      "pipefail",
      "-c",
      `source "${LIB}/common.sh"; source "${LIB}/prerequisites.sh"; source "${LIB}/commands.sh"; source "${LIB}/machine.sh"; WSL=2 OS=${os} REPO_DIR="${dir}/repo" PORT=3011; has_systemd() { return 0; }; is_running() { return 0; }; cmd_enable() { echo "enable called"; }; cmd_machine ${args}`,
      join(dir, "agent-os"),
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: join(dir, "bin"),
        HOME: dir,
        USER: "tester",
        NODE_ENV: "test",
        SSHD_FALLBACK: "",
        ...env,
      },
    }
  );
}

beforeEach(() => {
  dir = tempDir("aos-machine-");
  mkdirSync(join(dir, "bin"));
  for (const tool of TOOLS) {
    const real = ["/usr/bin", "/bin"]
      .map((d) => join(d, tool))
      .find(existsSync);
    if (real) symlinkSync(real, join(dir, "bin", tool));
  }
  fake("uname", 'echo "Linux"');
  record("sudo");
  fake("sshd", "true");
  fake("systemctl", "exit 0");
  fake("curl", "exit 0");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("agent-os machine", () => {
  it("bare, points at Connect first, mentions --tailscale and changes nothing", () => {
    const r = machine({}, "debian", "");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("agent-os connect");
    expect(r.stdout).toContain("agent-os link accept");
    expect(r.stdout).toContain("agent-os machine --tailscale");
    expect(r.stdout).not.toContain("enable called");
    expect(log()).toBe("");
  });

  it("rejects an unknown option", () => {
    const r = machine({}, "debian", "--bogus");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("Usage: agent-os machine");
    expect(log()).toBe("");
  });

  it("stops with the install pointer when Tailscale is missing", () => {
    const r = machine();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Tailscale isn't installed");
    expect(log()).toContain("sudo systemctl enable --now sshd");
  });

  it("stops with 'tailscale up' when signed out", () => {
    fake("tailscale", "echo '{\"Self\":{}}'");
    const r = machine();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("sudo tailscale up");
  });

  it("prints the values for the machine you'll link from, never a Mac-only line", () => {
    fake(
      "tailscale",
      'case "$1" in ip) echo 100.64.0.9;; *) echo \'{"Self":{"DNSName":"pc-wsl.tail1234.ts.net."}}\';; esac'
    );
    const r = machine();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("enable called");
    expect(r.stdout).toContain("pc-wsl.tail1234.ts.net");
    expect(r.stdout).toContain("http://pc-wsl.tail1234.ts.net:3011");
    expect(r.stdout).toContain("ssh-copy-id tester@pc-wsl.tail1234.ts.net");
    expect(r.stdout).toContain("the machine you'll link from");
    expect(r.stdout).not.toMatch(/on the mac\b/i);
  });

  it("installs openssh-server on Debian when sshd is missing, and never touches sshd_config", () => {
    rmSync(join(dir, "bin", "sshd"));
    machine();
    expect(log()).toContain("sudo apt-get install -y openssh-server");
    expect(log()).not.toMatch(/sshd_config|authorized_keys/);
  });

  it("needs systemd", () => {
    mkdirSync(join(dir, "repo"), { recursive: true });
    const r = spawnSync(
      "/bin/bash",
      [
        "-c",
        `source "${LIB}/common.sh"; source "${LIB}/machine.sh"; WSL=2 OS=debian REPO_DIR="${dir}/repo"; has_systemd() { return 1; }; cmd_machine --tailscale`,
      ],
      {
        encoding: "utf8",
        env: { PATH: join(dir, "bin"), HOME: dir, NODE_ENV: "test" },
      }
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("systemd");
  });
});
