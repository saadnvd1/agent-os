import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[][] = [];
// What `gh pr merge` fails with, or null to merge.
let mergeError: string | null = null;
// What `gh repo view` says, or null when it fails.
let repoView: Record<string, unknown> | null = null;

vi.mock("./gh", () => ({
  run: async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[0] === "repo") {
      if (!repoView) throw new Error("gh: HTTP 502");
      return JSON.stringify(repoView);
    }
    if (mergeError) throw new Error(mergeError);
    return "";
  },
}));

const { mergePR } = await import("./merge-pr");

const ALL = {
  nameWithOwner: "o/r",
  squashMergeAllowed: true,
  mergeCommitAllowed: true,
  rebaseMergeAllowed: true,
};

beforeEach(() => {
  calls.length = 0;
  mergeError = null;
  repoView = ALL;
});

describe("mergePR", () => {
  it.each([
    ["squash", "--squash"],
    ["merge", "--merge"],
    ["rebase", "--rebase"],
  ] as const)(
    "passes %s to gh as %s, pinned to the head",
    async (method, flag) => {
      await mergePR({ repo: "/r", number: 7, method, head: "abc" });
      expect(calls).toEqual([
        ["gh", "pr", "merge", "7", flag, "--match-head-commit", "abc"],
      ]);
    }
  );

  it("names another repository's PR with --repo", async () => {
    await mergePR({ repo: "/r", number: 3, method: "merge", slug: "x/y" });
    expect(calls).toEqual([
      ["gh", "pr", "merge", "3", "--repo", "x/y", "--merge"],
    ]);
  });

  it("refuses a method the repository turned off, naming it and the setting, and never falls back", async () => {
    mergeError =
      "GraphQL: Merge method rebase merging is not allowed on this repository (mergePullRequest)";
    repoView = { ...ALL, rebaseMergeAllowed: false };
    const err = await mergePR({
      repo: "/r",
      number: 7,
      method: "rebase",
      head: "abc",
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(
      /GitHub refused to merge PR #7 with the rebase method: o\/r has "Allow rebase merging" turned off/
    );
    expect((err as Error).message).toMatch(/doesn't fall back/);
    expect((err as Error).message).toMatch(/squash, merge commit/);
    const merges = calls.filter((c) => c[2] === "merge");
    expect(merges).toEqual([
      ["gh", "pr", "merge", "7", "--rebase", "--match-head-commit", "abc"],
    ]);
  });

  it("says so plainly when GitHub refuses the method and the repository can't be read", async () => {
    mergeError = "Merge commits are not allowed on this repository";
    repoView = null;
    await expect(
      mergePR({ repo: "/r", number: 9, method: "merge" })
    ).rejects.toThrow(/merge commit method[\s\S]*"Allow merge commits"/);
  });

  it("passes any other refusal through unchanged", async () => {
    mergeError =
      "Pull request is not mergeable: the base branch policy prohibits the merge";
    await expect(
      mergePR({ repo: "/r", number: 9, method: "squash" })
    ).rejects.toThrow("Pull request is not mergeable");
  });
});
