// The branch and rebase mechanics against real git, with a local bare repo
// as origin. Only gh is absent: these moves pass no PR to retarget.

import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../tasks/gh";
import { restackBranch, type Runner } from "./git";
import { MERGE_METHODS, type MergeMethod } from "../tasks/merge-methods";

const runner: Runner = (cmd, args, cwd) => run(cmd, args, cwd);
const git = async (cwd: string, ...args: string[]) =>
  (await run("git", args, cwd)).trim();

let root: string;
let repo: string;

async function commit(
  cwd: string,
  file: string,
  text: string,
  message: string
) {
  writeFileSync(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "commit", "-q", "-m", message);
}

// A worktree on a new branch cut from `from`, with `commits` pushed to origin.
async function branch(
  name: string,
  from: string,
  commits: Array<[string, string]>
) {
  const wt = join(root, name.replace("/", "-"));
  await git(repo, "worktree", "add", "-q", "-b", name, wt, from);
  for (const [file, text] of commits)
    await commit(wt, file, text, `${name}: ${file}`);
  await git(wt, "push", "-q", "-u", "origin", name);
  return wt;
}

// Merge a branch into main on origin the way `gh pr merge` does with each
// method: one squashed commit, a merge commit keeping the branch's commits,
// or the branch's commits replayed onto main as new commits.
async function ghMerge(name: string, method: MergeMethod) {
  if (method === "squash") {
    await git(repo, "merge", "-q", "--squash", `origin/${name}`);
    await git(repo, "commit", "-q", "-m", `${name} (squashed)`);
  } else if (method === "merge") {
    await git(
      repo,
      "merge",
      "-q",
      "--no-ff",
      "-m",
      `Merge ${name}`,
      `origin/${name}`
    );
  } else {
    await git(repo, "cherry-pick", `main..origin/${name}`);
  }
  await git(repo, "push", "-q", "origin", "main");
  await git(repo, "fetch", "-q", "origin");
}
const squashMerge = (name: string) => ghMerge(name, "squash");

const subjects = async (range: string) =>
  (await git(repo, "log", "--format=%s", range)).split("\n").filter(Boolean);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "stack-git-"));
  const origin = join(root, "origin.git");
  await git(root, "init", "-q", "--bare", "-b", "main", origin);
  repo = join(root, "repo");
  await git(root, "clone", "-q", origin, repo);
  for (const [k, v] of [
    ["user.name", "T"],
    ["user.email", "t@t"],
    ["commit.gpgsign", "false"],
  ]) {
    await git(repo, "config", k, v);
  }
  await git(repo, "checkout", "-q", "-b", "main");
  await commit(repo, "base.txt", "one\ntwo\nthree\n", "base");
  await git(repo, "push", "-q", "-u", "origin", "main");
});

describe("a stack on real git", () => {
  it.each(MERGE_METHODS)(
    "cuts the child from the parent's pushed tip, and after a %s merge leaves each level its own commits",
    async (method) => {
      await branch("feature/p", "origin/main", [
        ["p1.txt", "p1"],
        ["p2.txt", "p2"],
      ]);
      const pTip = await git(repo, "rev-parse", "origin/feature/p");
      const cWt = await branch("feature/c", pTip, [["c.txt", "c"]]);
      const cTip = await git(repo, "rev-parse", "origin/feature/c");
      const gWt = await branch("feature/g", cTip, [["g.txt", "g"]]);
      // Before the merge each PR's diff is its own commits only.
      expect(await subjects("origin/feature/p..origin/feature/c")).toEqual([
        "feature/c: c.txt",
      ]);

      // Main moved on meanwhile, so a rebase merge writes new commits.
      await commit(repo, "other.txt", "other", "other work on main");
      await ghMerge("feature/p", method);
      const child = await restackBranch(
        {
          name: "C",
          repo,
          worktree: cWt,
          branch: "feature/c",
          oldTip: pTip,
          onto: "main",
          retargetPr: null,
        },
        runner
      );
      expect(child).toMatchObject({
        ok: true,
        newTip: await git(repo, "rev-parse", "origin/main"),
      });
      expect(await subjects("origin/main..origin/feature/c")).toEqual([
        "feature/c: c.txt",
      ]);

      const grand = await restackBranch(
        {
          name: "G",
          repo,
          worktree: gWt,
          branch: "feature/g",
          oldTip: cTip,
          onto: "feature/c",
          retargetPr: null,
        },
        runner
      );
      expect(grand).toMatchObject({
        ok: true,
        newTip: await git(repo, "rev-parse", "origin/feature/c"),
      });
      expect(await subjects("origin/feature/c..origin/feature/g")).toEqual([
        "feature/g: g.txt",
      ]);
      expect(
        await git(repo, "diff", "--name-only", "origin/main...origin/feature/g")
      ).toBe("c.txt\ng.txt");
    }
  );

  it("aborts a conflict and leaves the worktree as it was", async () => {
    await branch("feature/p", "origin/main", [["p.txt", "p"]]);
    const pTip = await git(repo, "rev-parse", "origin/feature/p");
    const cWt = await branch("feature/c", pTip, [
      ["base.txt", "one\nCHILD\nthree\n"],
    ]);
    const before = await git(cWt, "rev-parse", "HEAD");
    await commit(
      repo,
      "base.txt",
      "one\nMAIN\nthree\n",
      "main changes the same line"
    );
    await squashMerge("feature/p");

    const result = await restackBranch(
      {
        name: "C",
        repo,
        worktree: cWt,
        branch: "feature/c",
        oldTip: pTip,
        onto: "main",
        retargetPr: null,
      },
      runner
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(
      `git rebase --onto origin/main ${pTip}`
    );
    expect(await git(cWt, "rev-parse", "HEAD")).toBe(before);
    expect(await git(cWt, "status", "--porcelain")).toBe("");
  });

  it("refuses when origin has commits the worktree lacks, rather than dropping them", async () => {
    await branch("feature/p", "origin/main", [["p.txt", "p"]]);
    const pTip = await git(repo, "rev-parse", "origin/feature/p");
    const cWt = await branch("feature/c", pTip, [["c.txt", "c"]]);
    const other = join(root, "other");
    await git(
      root,
      "clone",
      "-q",
      "-b",
      "feature/c",
      join(root, "origin.git"),
      other
    );
    await git(other, "config", "user.email", "o@o");
    await git(other, "config", "user.name", "O");
    await commit(other, "o.txt", "o", "pushed from elsewhere");
    await git(other, "push", "-q", "origin", "feature/c");
    await squashMerge("feature/p");

    const result = await restackBranch(
      {
        name: "C",
        repo,
        worktree: cWt,
        branch: "feature/c",
        oldTip: pTip,
        onto: "main",
        retargetPr: null,
      },
      runner
    );
    expect(!result.ok && result.error).toContain(
      "has commits this worktree does not"
    );
    expect(await subjects("origin/main..origin/feature/c")).toContain(
      "pushed from elsewhere"
    );
  });

  it("finishes a restack someone resolved by hand without rebasing again", async () => {
    await branch("feature/p", "origin/main", [["p.txt", "p"]]);
    const pTip = await git(repo, "rev-parse", "origin/feature/p");
    const cWt = await branch("feature/c", pTip, [["c.txt", "c"]]);
    await squashMerge("feature/p");
    await git(cWt, "rebase", "-q", "--onto", "origin/main", pTip);
    await git(cWt, "push", "-q", "--force-with-lease", "origin", "feature/c");
    await git(repo, "fetch", "-q", "origin");

    const result = await restackBranch(
      {
        name: "C",
        repo,
        worktree: cWt,
        branch: "feature/c",
        oldTip: pTip,
        onto: "main",
        retargetPr: null,
      },
      runner
    );
    expect(result.ok).toBe(true);
    expect(await subjects("origin/main..origin/feature/c")).toEqual([
      "feature/c: c.txt",
    ]);
  });
});
