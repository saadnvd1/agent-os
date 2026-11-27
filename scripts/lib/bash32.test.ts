import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { BASH, fakeTool, LIB, runInstaller } from "./installer-harness";

// The installer runs on whatever bash the OS has: macOS ships 3.2, which has
// no associative arrays, mapfile or ${x,,}, and which treats "${arr[*]}" of an
// empty array as unbound under `set -u`. A user with no AI CLI installed hit
// that. These run the real scripts under /bin/bash.
const SCRIPTS = [
  ...readdirSync(LIB)
    .filter((f) => f.endsWith(".sh"))
    .map((f) => join(LIB, f)),
  join(LIB, "..", "agent-os"),
  join(LIB, "..", "install.sh"),
];

const BANNED: Array<[RegExp, string]> = [
  [/declare\s+-A|local\s+-A/, "associative arrays (bash 4)"],
  [/\bmapfile\b|\breadarray\b/, "mapfile/readarray (bash 4)"],
  [/\$\{[A-Za-z_]+(,,|\^\^)\}/, "case-changing expansion (bash 4)"],
  [/\[\[\s+-v\s/, "[[ -v ]] (bash 4.2)"],
  [/local\s+-n\b/, "namerefs (bash 4.3)"],
  [/\$\{[A-Za-z_]+\[-1\]\}/, "negative array index (bash 4.3)"],
  [/&>>|\|&/, "&>> and |& (bash 4)"],
];

describe("installer scripts stay bash 3.2 clean", () => {
  it.each(SCRIPTS.map((f) => [f.slice(LIB.length - 11), f]))(
    "%s uses no bash 4+ syntax",
    (_name, file) => {
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"))
        .join("\n");
      for (const [re, what] of BANNED) expect(text, what).not.toMatch(re);
    }
  );

  it.each(SCRIPTS.map((f) => [f.slice(LIB.length - 11), f]))(
    "%s parses under /bin/bash",
    (_name, file) => {
      const r = runBashN(file);
      expect(r).toBe("");
    }
  );
});

function runBashN(file: string): string {
  return spawnSync(BASH, ["-n", file], { encoding: "utf8" }).stderr;
}

describe("the installer under /bin/bash -euo pipefail with no agent CLI", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir("aos-bash32-");
    fakeTool(dir, "curl", `echo "curl $*" >> "${dir}/calls.log"; exit 22`);
    fakeTool(
      dir,
      "brew",
      `echo "Error: untrusted tap homebrew/foo" >&2; exit 1`
    );
  });

  it("detects nothing without an unbound variable", () => {
    const r = runInstaller(dir, `echo "[$(detect_ai_clis)]"`);
    expect(r.stderr).not.toMatch(/unbound|bad substitution/);
    expect(r.stdout).toContain("[]");
    expect(r.status).toBe(0);
  });

  it("non-interactive: installs nothing, names the commands, carries on", () => {
    const r = runInstaller(dir, "prompt_ai_cli_install; echo reached-end");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("npm install -g @anthropic-ai/claude-code");
    expect(r.stdout).toContain("@google/gemini-cli");
    expect(r.stdout).toContain("reached-end");
    expect(r.stderr).not.toMatch(/unbound|bad substitution/);
    expect(runInstaller(dir, "cat calls.log 2>/dev/null || true").stdout).toBe(
      ""
    );
  });

  it("interactive with the input closed: skips instead of dying on read", () => {
    const r = runInstaller(
      dir,
      "is_interactive() { return 0; }; prompt_ai_cli_install; echo reached-end"
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Skipping AI CLI installation");
    expect(r.stdout).toContain("reached-end");
  });

  it("a failing agent installer names the manual command and doesn't stop", () => {
    const r = runInstaller(
      dir,
      "is_interactive() { return 0; }; prompt_ai_cli_install; echo reached-end",
      { input: "1\n" }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Couldn't install Claude Code");
    expect(r.stdout).toContain("npm install -g @anthropic-ai/claude-code");
    expect(r.stdout).toContain("reached-end");
  });

  it("a Homebrew failure names the cause and the command, not a shell error", () => {
    const r = runInstaller(dir, "brew_install tmux");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("brew trust");
    expect(r.stdout).toContain("brew install tmux");
    expect(r.stderr).not.toMatch(/unbound|bad substitution/);
  });

  it("the whole prerequisite check works with nothing missing under set -u", () => {
    for (const tool of ["node", "git", "tmux", "rg", "lsof", "cc"])
      fakeTool(
        dir,
        tool,
        tool === "node" ? `echo v22.1.0` : `echo ${tool} 1.0`
      );
    const r = runInstaller(dir, "check_and_install_prerequisites");
    expect(r.stderr).not.toMatch(/unbound|bad substitution/);
    expect(r.stdout).toMatch(/prerequisites|Missing/i);
  });
});
