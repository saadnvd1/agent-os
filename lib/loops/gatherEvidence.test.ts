import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { commandsFromBase, fillPlaceholder } from "./gatherEvidence";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "pipe",
  });

describe("the commands the evidence run uses", () => {
  it("come from the base branch, not the coder's working tree", async () => {
    const repo = tempDir("loop-base-");
    git(repo, "init", "-q", "-b", "main");
    fs.writeFileSync(
      path.join(repo, "agentos.json"),
      JSON.stringify({
        test: "npm run typecheck && npx vitest run <test files>",
      })
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    git(repo, "checkout", "-qb", "feature");
    fs.writeFileSync(
      path.join(repo, "agentos.json"),
      JSON.stringify({ test: "true" })
    );
    expect(await commandsFromBase(repo, "main")).toEqual({
      typecheck: "npm run typecheck",
      test: "npx vitest run <test files>",
    });
  });

  it("have no commands when the base has no config", async () => {
    const repo = tempDir("loop-base-none-");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-qm", "empty", "--allow-empty");
    expect(await commandsFromBase(repo, "main")).toEqual({
      typecheck: null,
      test: null,
    });
  });

  it("fill a placeholder with the changed test files, or skip", () => {
    expect(
      fillPlaceholder("npx vitest run <test files>", ["a.test.ts"]).command
    ).toBe('npx vitest run "a.test.ts"');
    expect(
      fillPlaceholder("npx vitest run <test files>", []).command
    ).toBeNull();
    expect(fillPlaceholder("npm test", []).command).toBe("npm test");
  });
});
