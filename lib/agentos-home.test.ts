import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { agentosHome } from "./agentos-home";

describe("agentosHome", () => {
  it("resolves under the test home, never the account's", () => {
    expect(agentosHome("worktrees")).toBe(
      path.join(os.homedir(), ".agent-os", "worktrees")
    );
    expect(os.homedir()).not.toBe(os.userInfo().homedir);
  });

  it("refuses the real home under the test runner", () => {
    const prior = process.env.HOME;
    process.env.HOME = os.userInfo().homedir;
    try {
      expect(() => agentosHome("worktrees")).toThrow(/Refusing/);
    } finally {
      process.env.HOME = prior;
    }
  });
});

// A module that joins ".agent-os" by hand skips the guard above: how a test
// run once filled the real worktrees folder.
describe("no unguarded ~/.agent-os paths", () => {
  const roots = ["lib", "app", "mcp", "components", "data", "server.ts"];
  // Reads or writes through the project's own relative file, or only names the
  // folder in prose, not a path under the account's home.
  const ALLOWED = new Set([
    "lib/agentos-home.ts",
    "lib/test-home-guard.ts",
    // Takes a home as an argument and guards it itself.
    "lib/worktrees.ts",
    "lib/project-config/index.ts",
    "lib/dev-instance/liveServer.ts",
    "lib/updates/run.ts",
  ]);

  function files(p: string): string[] {
    if (!fs.existsSync(p)) return [];
    if (fs.statSync(p).isFile()) return [p];
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.name !== "node_modules" && e.name !== ".next")
      .flatMap((e) => files(path.join(p, e.name)));
  }

  it("builds them all through agentosHome()", () => {
    const stray = roots
      .flatMap((r) => files(path.join(process.cwd(), r)))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => path.relative(process.cwd(), f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) =>
        /os\.homedir\(\)[^;]*"\.agent-os"|"\.agent-os"[^;]*os\.homedir\(\)/.test(
          fs.readFileSync(f, "utf8")
        )
      );
    expect(stray).toEqual([]);
  });
});
