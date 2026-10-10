import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { db, stackQueries as q } from "../db";
import { restackAfterMerge, stackNotice, type RestackDeps } from "./restack";
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
  const origHeads = new Map<string, string>();
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
      origHeads.set(wt, heads.get(wt) ?? "");
      heads.set(wt, `${wt}-rebased`);
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD")
      return heads.get(wt) ?? "";
    if (args[0] === "rev-parse" && args[1] === "ORIG_HEAD")
      return origHeads.get(wt) ?? "";
    if (args[0] === "push") remote.set(`origin/${args[4]}`, heads.get(wt)!);
    return "";
  };
  return { runner, calls, remote, heads };
}

const openPr = (n: number) => ({
  number: n,
  url: `https://github.com/o/r/pull/${n}`,
  state: "OPEN" as const,
  checks: "pass" as const,
});

// Deps around a fake runner: GitHub says feature/c has PR #12 open.
function depsFor(
  runner: Runner,
  extra: Partial<RestackDeps> = {}
): RestackDeps {
  return {
    runner,
    notify: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    defaultBranch: async () => "main",
    prOf: async (_repo, branch) => (branch === "feature/c" ? openPr(12) : null),
    ...extra,
  };
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
    const deps = depsFor(git.runner, { notify });

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

  it("records the heads it moved, so the task's code review still covers its branch", async () => {
    const { cWt, gWt, s } = seed();
    const [c, g] = [cWt, gWt].map((w) => w.split("/").pop()!);
    const git = fakeGit();
    git.heads.set(c, "c-old");
    git.heads.set(g, "g-old");
    // G was restacked before, and its task hasn't pushed since.
    q.updateItem(db, s.item("G").id, {
      restacked_from: "g-reviewed",
      restacked_to: "g-old",
    });

    await restackAfterMerge(s.session("P"), depsFor(git.runner));

    expect(s.item("C")).toMatchObject({
      restacked_from: "c-old",
      restacked_to: `${c}-rebased`,
    });
    expect(s.item("G")).toMatchObject({
      restacked_from: "g-reviewed",
      restacked_to: `${g}-rebased`,
    });
  });

  it("records before pushing, and keeps the record when a retry pushes that same commit", async () => {
    const { cWt, s } = seed();
    const c = cWt.split("/").pop()!;
    const git = fakeGit();
    git.heads.set(c, "c-old");
    let recordAtPush: unknown = null;
    let refuse = true;
    const runner: Runner = async (cmd, args, cwd) => {
      if (args[0] === "push" && args[4] === "feature/c") {
        recordAtPush = s.item("C").restacked_to;
        if (refuse) throw new Error("connection reset");
      }
      return git.runner(cmd, args, cwd);
    };
    await restackAfterMerge(s.session("P"), depsFor(runner));
    expect(recordAtPush).toBe(`${c}-rebased`);

    // The retry finds the worktree already rebased: no rebase, same commit.
    refuse = false;
    git.calls.length = 0;
    await restackAfterMerge(s.session("P"), depsFor(runner));
    expect(s.item("C")).toMatchObject({
      restacked_from: "c-old",
      restacked_to: `${c}-rebased`,
    });
  });

  it("records nothing reviewed when the worktree had commits the task never pushed", async () => {
    const { cWt, s } = seed();
    const git = fakeGit();
    git.heads.set(cWt.split("/").pop()!, "c-unpushed");
    // A record from an earlier restack must not survive.
    q.updateItem(db, s.item("C").id, {
      restacked_from: "c-reviewed",
      restacked_to: "c-old",
    });

    await restackAfterMerge(s.session("P"), depsFor(git.runner));

    expect(s.item("C")).toMatchObject({
      restacked_from: null,
      restacked_to: null,
    });
  });

  it("aborts a conflict, names the exact command and keeps the parent branch", async () => {
    const { cWt, s } = seed();
    const git = fakeGit({ conflict: cWt.split("/").pop() });
    const deps = depsFor(git.runner);

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
    await restackAfterMerge(s.session("P"), depsFor(runner));
    expect(s.item("C").error).toContain("uncommitted changes");
    expect(git.calls.some((l) => l.startsWith("gh"))).toBe(false);
  });
});

describe("restack, the review's cases", () => {
  it("retargets a PR opened after the watcher's last look", async () => {
    const { s } = seed();
    db.prepare(
      `UPDATE stack_items SET pr_number = NULL, status = 'running' WHERE id = ?`
    ).run(s.item("C").id);
    const git = fakeGit();
    await restackAfterMerge(s.session("P"), depsFor(git.runner));
    expect(git.calls).toContain("gh pr edit 12 --base main");
    expect(s.item("C")).toMatchObject({ pr_number: 12, status: "pr" });
  });

  it("keeps the parent's branch when GitHub can't say whether a child has a PR", async () => {
    const { s } = seed();
    const git = fakeGit();
    const result = await restackAfterMerge(
      s.session("P"),
      depsFor(git.runner, {
        prOf: async () => {
          throw new Error("gh: rate limited");
        },
      })
    );
    expect(result.stuck).toBe(true);
    expect(s.item("C").error).toContain("Couldn't read C's PR from GitHub");
    expect(git.calls.some((l) => l.startsWith("git rebase"))).toBe(false);
  });

  it("fails rather than rebasing onto a stale origin when the fetch fails", async () => {
    const { s } = seed();
    const git = fakeGit();
    const runner: Runner = (cmd, args, cwd) =>
      args[0] === "fetch"
        ? Promise.reject(
            Object.assign(new Error("x"), { stderr: "no network" })
          )
        : git.runner(cmd, args, cwd);
    const result = await restackAfterMerge(s.session("P"), depsFor(runner));
    expect(result.stuck).toBe(true);
    expect(s.item("C").error).toContain("Could not fetch origin");
    expect(
      git.calls.some((l) => l.startsWith("gh") || l.startsWith("git rebase"))
    ).toBe(false);
  });

  it("interrupts each agent before rewriting its worktree, and tells it to carry on", async () => {
    const { s } = seed();
    const git = fakeGit();
    const order: string[] = [];
    const runner: Runner = (cmd, args, cwd) => {
      if (args[0] === "rebase") order.push("rebase");
      return git.runner(cmd, args, cwd);
    };
    const notify = vi.fn(async (_to: string, _body: string) => {
      order.push("notify");
    });
    const interrupt = vi.fn(async () => {
      order.push("interrupt");
    });
    await restackAfterMerge(
      s.session("P"),
      depsFor(runner, { notify, interrupt })
    );
    expect(order).toEqual([
      "interrupt",
      "rebase",
      "notify",
      "interrupt",
      "rebase",
      "notify",
    ]);
    expect(notify.mock.calls[0][1]).toContain("carry on where you were");
  });

  it("doesn't interrupt a grandchild whose parent's branch didn't move", async () => {
    const { s } = seed();
    const git = fakeGit({ conflict: "none" });
    const interrupt = vi.fn().mockResolvedValue(undefined);
    // C was already moved: only G is looked at, and origin/feature/c is
    // still the commit G sits on.
    db.prepare(`UPDATE stack_items SET base_branch = 'main' WHERE id = ?`).run(
      s.item("C").id
    );
    await restackAfterMerge(s.session("P"), depsFor(git.runner, { interrupt }));
    expect(interrupt).not.toHaveBeenCalled();
    expect(git.calls.some((l) => l.startsWith("git rebase"))).toBe(false);
  });
});

describe("stackNotice", () => {
  it("reads as before to the agent, and shows in chat as AgentOS's", () => {
    expect(stackNotice("s1", "Rebased onto main")).toEqual({
      fromId: null,
      to: "s1",
      body: "Rebased onto main",
      origin: {
        kind: "system",
        label: "AgentOS stacks",
        body: "Rebased onto main",
      },
    });
  });
});
