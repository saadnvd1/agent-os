import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { BASH, fakeTool, LIB, runInstaller } from "./installer-harness";

let dir: string;
const home = () => join(dir, "home/.agent-os");
const calls = () => {
  try {
    return readFileSync(join(dir, "calls.log"), "utf8");
  } catch {
    return "";
  }
};
const markBuilt = () => {
  mkdirSync(join(home(), "repo/.next"), { recursive: true });
  writeFileSync(join(home(), "repo/.next/BUILD_ID"), "x");
};

// scripts/agent-os itself, with nothing installed, installed, or running.
function agentOs(...args: string[]) {
  const r = spawnSync(BASH, [join(LIB, "..", "agent-os"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      AGENT_OS_HOME: home(),
      AGENT_OS_PORT: "39011",
      NODE_ENV: "test",
    },
  });
  // eslint-disable-next-line no-control-regex
  return { ...r, stdout: r.stdout.replace(/\x1b\[[0-9;]*m/g, "") };
}

beforeEach(() => {
  dir = tempDir("aos-next-");
  mkdirSync(home(), { recursive: true });
  fakeTool(dir, "open", `echo "open $*" >> "${dir}/calls.log"`);
  fakeTool(dir, "sleep", "true");
  fakeTool(dir, "curl", `[ -f "${dir}/up" ]`);
});

describe("agent-os with no arguments", () => {
  it("not installed: says to run agent-os install, exits 0", () => {
    const r = agentOs();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Start here: agent-os install");
    expect(r.stdout).toContain("Usage: agent-os <command>");
  });

  it("installed: says to start it and where it will be", () => {
    markBuilt();
    const r = agentOs();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("agent-os start");
    expect(r.stdout).toContain("http://localhost:39011");
  });

  it("running: gives the address", () => {
    markBuilt();
    writeFileSync(join(home(), "agent-os.pid"), String(process.pid));
    const r = agentOs();
    expect(r.stdout).toContain("AgentOS is running: http://localhost:39011");
  });

  it("an unknown command still fails", () => {
    const r = agentOs("bogus");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Unknown command: bogus");
  });

  it("start before install names the command instead of failing inside", () => {
    const r = agentOs("start");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Run: agent-os install");
  });
});

describe("the end of agent-os install", () => {
  const finish = (arg = "true", extra = "") =>
    runInstaller(
      dir,
      `is_interactive() { return 0; }; cmd_start() { touch "${dir}/up"; }; ${extra || ":"}; install_finish ${arg} && echo "rc=0"`
    );

  it("starts it, prints the URL, opens the browser, and points at setup", () => {
    const r = finish();
    expect(r.stdout).toContain("AgentOS is running: http://localhost:3011");
    expect(r.stdout).toContain("setup");
    expect(calls()).toContain("open http://localhost:3011");
    expect(r.stdout).toContain("rc=0");
  });

  it("opens nothing with --no-open, and prints the URL instead", () => {
    const r = finish("false");
    expect(calls()).toBe("");
    expect(r.stdout).toContain(
      "Open it in your browser: http://localhost:3011"
    );
  });

  it("opens nothing when not interactive", () => {
    const r = runInstaller(
      dir,
      `cmd_start() { touch "${dir}/up"; }; install_finish true`
    );
    expect(calls()).toBe("");
    expect(r.stdout).toContain("Open it in your browser");
  });

  it("a server that never answers names the log command and fails", () => {
    const r = runInstaller(
      dir,
      `is_interactive() { return 0; }; cmd_start() { :; }; install_finish true || echo "rc=$?"`
    );
    expect(r.stdout).toContain("agent-os logs");
    expect(r.stdout).toContain("rc=1");
    expect(calls()).toBe("");
  });

  it("a held port is named and nothing is started", () => {
    const r = finish("true", `port_holder() { echo "node (PID 42)"; }`);
    expect(r.stdout).toContain("held by node (PID 42)");
    expect(r.stdout).toContain("AGENT_OS_PORT=3012");
    expect(r.stdout).not.toContain("is running");
  });

  it("start refuses a held port with the fix", () => {
    markBuilt();
    const r = runInstaller(
      dir,
      `port_holder() { echo "node (PID 42)"; }; cmd_start`
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("already used by node (PID 42)");
  });
});

describe("the failure guard", () => {
  it("an unexpected failure says where, and what to do", () => {
    const r = runInstaller(
      dir,
      `guard_begin; f() { false; echo not-here; }; f`
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("stopped on an unexpected error");
    expect(r.stdout).toContain("false");
    expect(r.stdout).not.toContain("not-here");
  });

  it("a named failure prints its own message and not the generic one", () => {
    const r = runInstaller(
      dir,
      `guard_begin; run_step "Building the app" "Run: agent-os install" false`
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Building the app failed.");
    expect(r.stdout).toContain("Run: agent-os install");
    expect(r.stdout).not.toContain("unexpected error");
  });

  it("a clean run prints nothing extra", () => {
    const r = runInstaller(dir, `guard_begin; true`);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
