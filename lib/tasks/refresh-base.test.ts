import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { git as gitIn } from "../git-exec";
import { refreshBase } from "./refresh-base";
import { tempDir } from "@/lib/test-temp";

const git = async (cwd: string, ...args: string[]) =>
  (await gitIn(cwd, args)).trim();

let root: string;
let repo: string;

async function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "commit", "-q", "-m", file);
}

// A task worktree cut from main, then main moves on.
async function setup() {
  const wt = join(root, "task");
  await git(repo, "worktree", "add", "-q", "-b", "plan", wt, "main");
  mkdirSync(join(wt, ".agentos"));
  writeFileSync(join(wt, ".agentos/.gitignore"), "*\n");
  writeFileSync(join(wt, ".agentos/plan.md"), "the plan");
  const advance = async () => {
    await commit(repo, "new.txt", "new");
    await git(repo, "push", "-q", "origin", "main");
  };
  const target = (): Parameters<typeof refreshBase>[0] => ({
    name: "plan",
    worktree: wt,
    branch: "plan",
    base: "main",
  });
  return { wt, advance, target };
}

beforeEach(async () => {
  root = tempDir("refresh-base-");
  const origin = join(root, "origin.git");
  repo = join(root, "repo");
  await git(root, "init", "-q", "--bare", "-b", "main", origin);
  await git(root, "clone", "-q", origin, repo);
  await git(repo, "config", "user.email", "t@t");
  await git(repo, "config", "user.name", "t");
  await commit(repo, "a.txt", "a\n");
  await git(repo, "push", "-q", "origin", "main");
});

describe("refreshBase", () => {
  it("moves an empty branch to the new base and keeps untracked files", async () => {
    const { wt, advance, target } = await setup();
    await advance();
    expect(await refreshBase(target())).toEqual({ moved: true, how: "reset" });
    expect(await git(wt, "rev-parse", "HEAD")).toBe(
      await git(repo, "rev-parse", "main")
    );
    expect(readFileSync(join(wt, ".agentos/plan.md"), "utf8")).toBe("the plan");
  });

  it("does nothing when already on the latest base", async () => {
    const { target } = await setup();
    expect(await refreshBase(target())).toEqual({ moved: false });
  });

  it("rebases a branch with commits when that is clean", async () => {
    const { wt, advance, target } = await setup();
    await commit(wt, "mine.txt", "mine");
    await advance();
    expect(await refreshBase(target())).toEqual({
      moved: true,
      how: "rebase",
    });
    expect(existsSync(join(wt, "new.txt"))).toBe(true);
    expect(existsSync(join(wt, "mine.txt"))).toBe(true);
  });

  it("leaves a conflicting branch as it was and says so", async () => {
    const { wt, advance, target } = await setup();
    await commit(wt, "a.txt", "mine\n");
    const before = await git(wt, "rev-parse", "HEAD");
    await commit(repo, "a.txt", "theirs\n");
    await git(repo, "push", "-q", "origin", "main");
    await advance();
    const out = await refreshBase(target());
    expect(out.moved).toBe(false);
    expect((out as { note?: string }).note).toMatch(/moved on/);
    expect(await git(wt, "rev-parse", "HEAD")).toBe(before);
    expect(await git(wt, "status", "--porcelain", "-uno")).toBe("");
    expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("mine\n");
  });
});
