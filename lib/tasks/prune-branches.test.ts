import { beforeEach, describe, expect, it, vi } from "vitest";

const SHA = (c: string) => c.repeat(40);
let branches = "";
let prs: object[] = [];
let tipOf: Record<string, string> = {};
const deleted: string[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    prepare: () => ({
      all: () =>
        [
          "t-merged",
          "t-closed",
          "t-moved",
          "t-open",
          "t-parent",
          "t-child",
          "t-nopr",
          "t-fork",
        ].map((branch_name) => ({ branch_name })),
    }),
  },
}));
vi.mock("@/lib/git-remote", () => ({ repoSlug: async () => "o/r" }));
vi.mock("@/lib/tasks/gh", () => ({
  run: async (_c: string, args: string[]) => {
    if (args[0] === "api" && args.includes("DELETE")) {
      deleted.push(args.at(-1)!.replace("repos/o/r/git/refs/heads/", ""));
      return "";
    }
    if (args[0] === "api" && args.includes("--paginate")) return branches;
    if (args[0] === "api") {
      const name = args[1].replace("repos/o/r/git/ref/heads/", "");
      return `${tipOf[name]}\n`;
    }
    if (args[0] === "repo") return "main\n";
    if (args[0] === "pr" && args.includes("--base")) {
      const base = args[args.indexOf("--base") + 1];
      return JSON.stringify(
        (prs as { state: string; baseRefName: string; number: number }[])
          .filter((p) => p.state === "OPEN" && p.baseRefName === base)
          .map((p) => ({ number: p.number }))
      );
    }
    return JSON.stringify(prs);
  },
}));

import { pruneRepo, pruneText } from "./prune-branches";

const pr = (
  number: number,
  headRefName: string,
  state: string,
  oid: string,
  extra = {}
) => ({
  number,
  headRefName,
  state,
  headRefOid: oid,
  baseRefName: "main",
  isCrossRepository: false,
  ...extra,
});
const repo = { dir: "/r", slug: "o/r", projectIds: ["p"] };

beforeEach(() => {
  deleted.length = 0;
  const tips: Record<string, string> = {
    main: SHA("0"),
    "t-merged": SHA("a"),
    "t-closed": SHA("b"),
    "t-moved": SHA("c"),
    "t-open": SHA("d"),
    "t-parent": SHA("e"),
    "t-child": SHA("f"),
    "t-nopr": SHA("1"),
    "t-fork": SHA("2"),
    "human-branch": SHA("3"),
  };
  tipOf = tips;
  branches = Object.entries(tips)
    .map(([n, s]) => `${n}\t${s}`)
    .join("\n");
  prs = [
    pr(1, "t-merged", "MERGED", SHA("a")),
    pr(2, "t-closed", "CLOSED", SHA("b")),
    pr(3, "t-moved", "MERGED", SHA("9")),
    pr(4, "t-open", "OPEN", SHA("d")),
    pr(5, "t-parent", "MERGED", SHA("e")),
    pr(6, "t-child", "OPEN", SHA("f"), { baseRefName: "t-parent" }),
    pr(7, "t-fork", "MERGED", SHA("2"), { isCrossRepository: true }),
    pr(8, "human-branch", "MERGED", SHA("3")),
  ];
});

describe("pruneRepo", () => {
  it("lists only task branches whose PR is merged or closed at the branch's head", async () => {
    const out = await pruneRepo(repo);
    expect(out.stale.map((s) => s.branch)).toEqual(["t-closed", "t-merged"]);
    const why = Object.fromEntries(out.kept.map((k) => [k.branch, k.why]));
    expect(why["t-moved"]).toContain("moved to ccccccc");
    expect(why["t-open"]).toContain("open PR #4");
    expect(why["t-parent"]).toContain("open PR #6");
    expect(why["t-nopr"]).toBe("no PR");
    expect(why["t-fork"]).toBe("no PR");
    expect(why["human-branch"]).toContain("not an AgentOS task");
    expect(why.main).toBeUndefined();
  });

  it("is a dry run unless asked: nothing is deleted", async () => {
    await pruneRepo(repo);
    expect(deleted).toEqual([]);
    expect(pruneText([await pruneRepo(repo)], false)).toContain("Dry run");
  });

  it("deletes the stale branches with yes, re-checking each", async () => {
    tipOf["t-closed"] = SHA("7");
    const out = await pruneRepo(repo, { yes: true });
    expect(deleted).toEqual(["t-merged"]);
    expect(out.deleted).toEqual(["t-merged"]);
    expect(out.kept.find((k) => k.branch === "t-closed")?.why).toContain(
      "moved"
    );
  });
});
