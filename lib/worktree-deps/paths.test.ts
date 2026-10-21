import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { ignoreStaging } from "./paths";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

describe("ignoreStaging", () => {
  it("writes the exclude once, from the repo and from a worktree", async () => {
    const dir = tempDir("ig-");
    sh(dir, "init", "-q", "-b", "main");
    sh(dir, "config", "user.email", "t@example.test");
    sh(dir, "config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "a"), "1");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-q", "-m", "i");
    const wt = path.join(tempDir("ig-wt-"), "wt");
    sh(dir, "worktree", "add", "-q", "-b", "f", wt);
    await ignoreStaging(wt);
    await ignoreStaging(wt);
    await ignoreStaging(dir);
    const file = path.join(dir, ".git", "info", "exclude");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    expect(lines.filter((l) => l === "*.aos-partial")).toHaveLength(1);
    fs.mkdirSync(path.join(wt, "node_modules.aos-partial"));
    fs.writeFileSync(path.join(wt, "node_modules.aos-partial", "x"), "1");
    expect(sh(wt, "status", "--porcelain")).toBe("");
  });

  it("does nothing outside a repository", async () => {
    const dir = tempDir("ig-none-");
    await expect(ignoreStaging(dir)).resolves.toBeUndefined();
  });
});
