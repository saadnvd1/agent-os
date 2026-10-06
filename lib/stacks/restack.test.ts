import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { restackAfterMerge, type RestackDeps } from "./restack";
import { seedStack } from "./testing";
import type { Runner } from "./git";

const dir = () => mkdtempSync(join(tmpdir(), "stack-restack-"));

// A fake git/gh: remote refs live in a map, a push moves one.
function fakeGit(opts: { conflict?: string } = {}) {
  const remote = new Map([
    ["origin/main", "main-1"],
    ["origin/feature/c", "c-old"],
    ["origin/feature/g", "g-old"],
  ]);
  const heads = new Map<string, string>();
  const calls: string[] = [];
  const runner: Runner = async (cmd, args, cwd) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    const wt = cwd.split("/").pop()!;
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      const sha = remote.get(args[3]);
      if (!sha) throw new Error("unknown ref");
      return sha;
    }
    if (line.includes("merge-base --is-ancestor origin/"))
      throw new Error("not an ancestor");
    if (args[0] === "rebase" && args[1] === "--onto") {
      if (opts.conflict === wt)
        throw Object.assign(new Error("x"), { stderr: "CONFLICT" });
      heads.set(wt, `${wt}-rebased`);
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD")
      return heads.get(wt) ?? "";
    if (args[0] === "push") remote.set(`origin/${args[4]}`, heads.get(wt)!);
    return "";
  };
  return { runner, calls, remote };
}

// The fake keys each worktree by its folder name.
function seed() {
  const cWt = mkdtempSync(join(tmpdir(), "c"));
  const gWt = mkdtempSync(join(tmpdir(), "g"));
  const s = seedStack(dir(), [
    { key: "P", status: "merged", branch: "feature/p", pr: 11 },
    {
      key: "C",
      parent: "P",
      status: "pr",
      branch: "feature/c",
      worktree: cWt,
      baseTip: "p-tip",
      baseBranch: "feature/p",
      pr: 12,
    },
    {
      key: "G",
      parent: "C",
      status: "pr",
      branch: "feature/g",
      worktree: gWt,
      baseTip: "c-old",
      baseBranch: "feature/c",
      pr: 13,
    },
  ]);
  return { cWt, gWt, s };
}

describe("restack after a squash merge", () => {
  it("retargets the child's PR BEFORE rebasing it, then moves the grandchild onto it", async () => {
    const { cWt, s } = seed();
    const git = fakeGit();
    const notify = vi.fn().mockResolvedValue(undefined);
    const deps: RestackDeps = {
      runner: git.runner,
      notify,
      defaultBranch: async () => "main",
    };

    const result = await restackAfterMerge(s.session("P"), deps);

    expect(result.stuck).toBe(false);
    const c = cWt.split("/").pop();
    const relevant = git.calls.filter((l) => /^(gh|git (rebase|push))/.test(l));
    expect(relevant).toEqual([
      "gh pr edit 12 --base main",
      "git rebase --onto origin/main p-tip",
      "git push --no-verify --force-with-lease=feature/c:c-old origin feature/c",
      "git rebase --onto origin/feature/c c-old",
      "git push --no-verify --force-with-lease=feature/g:g-old origin feature/g",
    ]);
    expect(git.remote.get("origin/feature/c")).toBe(`${c}-rebased`);
    expect(s.item("C")).toMatchObject({
      base_branch: "main",
      base_tip: "main-1",
      error: null,
    });
    // The grandchild keeps targeting its parent, now on the rewritten branch.
    expect(s.item("G")).toMatchObject({
      base_branch: "feature/c",
      base_tip: `${c}-rebased`,
    });
    expect(s.item("P").status).toBe("merged");
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][1]).toContain("retargeted your PR to main");
  });

  it("aborts a conflict, names the exact command and keeps the parent branch", async () => {
    const { cWt, s } = seed();
    const git = fakeGit({ conflict: cWt.split("/").pop() });
    const deps: RestackDeps = {
      runner: git.runner,
      notify: vi.fn(),
      defaultBranch: async () => "main",
    };

    const result = await restackAfterMerge(s.session("P"), deps);

    expect(result.stuck).toBe(true);
    expect(git.calls).toContain("git rebase --abort");
    expect(s.item("C").error).toContain(
      `cd ${cWt} && git rebase --onto origin/main p-tip`
    );
    expect(s.item("C").base_branch).toBe("feature/p");
    expect(s.item("G").error).toBe("Waits for C to be restacked first.");
    expect(git.calls.some((l) => l.startsWith("git push"))).toBe(false);
  });

  it("refuses a dirty worktree without touching the PR", async () => {
    const { cWt, s } = seed();
    const git = fakeGit();
    const runner: Runner = (cmd, args, cwd) =>
      args[0] === "status" && cwd === cWt
        ? Promise.resolve(" M file.ts")
        : git.runner(cmd, args, cwd);
    await restackAfterMerge(s.session("P"), {
      runner,
      notify: vi.fn(),
      defaultBranch: async () => "main",
    });
    expect(s.item("C").error).toContain("uncommitted changes");
    expect(git.calls.some((l) => l.startsWith("gh"))).toBe(false);
  });
});
