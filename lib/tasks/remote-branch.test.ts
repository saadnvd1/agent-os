import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[][] = [];
let tip: string | Error = "";
let kids: number[] = [];
let deleteError: Error | null = null;

vi.mock("@/lib/tasks/gh", () => ({
  run: async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "pr")
      return JSON.stringify(kids.map((number) => ({ number })));
    if (args.includes("DELETE")) {
      if (deleteError) throw deleteError;
      return "";
    }
    if (tip instanceof Error) throw tip;
    return `${tip}\n`;
  },
}));
vi.mock("@/lib/git-remote", () => ({ repoSlug: async () => "o/r" }));

import { deleteTaskBranch } from "./remote-branch";

const HEAD = "a".repeat(40);
const base = { repo: "/r", branch: "feature/x-1", prHead: HEAD, slug: "o/r" };
const deletes = () => calls.filter((c) => c.includes("DELETE"));

beforeEach(() => {
  calls.length = 0;
  tip = HEAD;
  kids = [];
  deleteError = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("deleteTaskBranch", () => {
  it("deletes the ref through the API when the tip is the PR's head", async () => {
    expect(await deleteTaskBranch(base)).toMatchObject({ deleted: true });
    expect(deletes()).toEqual([
      ["api", "-X", "DELETE", "repos/o/r/git/refs/heads/feature/x-1"],
    ]);
  });

  it.each(["main", "master", "HEAD"])("never deletes %s", async (branch) => {
    expect((await deleteTaskBranch({ ...base, branch })).deleted).toBe(false);
    expect(calls).toEqual([]);
  });

  it("never deletes a base branch", async () => {
    const out = await deleteTaskBranch({
      ...base,
      keep: [null, "feature/x-1"],
    });
    expect(out).toMatchObject({ deleted: false, why: "it is a base branch" });
    expect(calls).toEqual([]);
  });

  it("keeps a branch another open PR is based on", async () => {
    kids = [42];
    const out = await deleteTaskBranch(base);
    expect(out.deleted).toBe(false);
    expect(out.why).toContain("#42");
    expect(deletes()).toEqual([]);
  });

  it("keeps it while the caller knows stacked cards build on it", async () => {
    expect(
      (await deleteTaskBranch({ ...base, hasChildren: true })).deleted
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it("keeps a branch with commits pushed after the PR's head, and says why", async () => {
    tip = "b".repeat(40);
    const out = await deleteTaskBranch(base);
    expect(out.deleted).toBe(false);
    expect(out.why).toContain("moved to bbbbbbb");
    expect(deletes()).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("kept origin/feature/x-1")
    );
  });

  it("keeps it when no PR head was recorded", async () => {
    expect((await deleteTaskBranch({ ...base, prHead: null })).deleted).toBe(
      false
    );
    expect(calls).toEqual([]);
  });

  it("treats an already-gone ref as fine, at lookup and at delete", async () => {
    tip = new Error("gh: Not Found (HTTP 404)");
    expect(await deleteTaskBranch(base)).toMatchObject({
      deleted: false,
      why: "already gone",
    });
    tip = HEAD;
    deleteError = new Error("gh: Reference does not exist (HTTP 422)");
    expect((await deleteTaskBranch(base)).deleted).toBe(true);
  });

  it("never throws: a GitHub failure is a logged line", async () => {
    tip = new Error("HTTP 502 from api.github.com");
    const out = await deleteTaskBranch(base);
    expect(out.deleted).toBe(false);
    expect(out.why).toContain("502");
    expect(console.log).toHaveBeenCalled();
  });
});
