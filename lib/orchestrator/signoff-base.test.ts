import "./signoff.test-helpers";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  S,
  answerAsk,
  changedFiles,
  commit,
  db,
  fetchRefs,
  getAsk,
  getCheck,
  getTaskSession,
  git,
  merges,
  openAsks,
  review,
  reviewNow,
  reviewer,
  runTool,
  seedSession,
  setup,
  stackQueries,
} from "./signoff.test-helpers";

describe("the PR's real base", () => {
  const baseOf = (task: string) =>
    (
      db.prepare(`SELECT base_branch FROM sessions WHERE id = ?`).get(task) as {
        base_branch: string | null;
      }
    ).base_branch;

  // The task stacked on a parent item, whose session is on `parentBranch`.
  function stackOn(
    t: ReturnType<typeof setup>,
    parentStatus: "dropped" | "pr" | "merged",
    parentBranch: string
  ) {
    const { project_id } = db
      .prepare(`SELECT project_id FROM sessions WHERE id = ?`)
      .get(t.task) as { project_id: string };
    const parentSession = seedSession({
      projectId: project_id,
      name: "parent",
      task: true,
      branch: parentBranch,
    });
    const item = (
      id: string,
      position: number,
      status: "dropped" | "pr" | "merged",
      session: string,
      parent: string | null
    ) => ({
      id,
      position,
      lh_card_id: `card-${id}`,
      ticket: id,
      title: id,
      parent_item_id: parent,
      also_item_ids: "[]",
      blocker_item_ids: JSON.stringify(parent ? [parent] : []),
      status,
      session_id: session,
      base_branch: parent ? parentBranch : "main",
      base_tip: null,
      note: null,
      held_outside: 0,
    });
    const parentId = `p-${t.task}`;
    const childId = `c-${t.task}`;
    stackQueries.create(
      db,
      {
        id: `stack-${t.task}`,
        project_id,
        lh_board_id: `board-${t.task}`,
        name: "s",
        max_parallel: 3,
      },
      [
        item(parentId, 0, parentStatus, parentSession, null),
        item(childId, 1, "pr", t.task, parentId),
      ]
    );
    return () => stackQueries.item(db, childId)!;
  }

  it("diffs a PR GitHub retargeted to main, off a dropped parent's deleted branch, against main", async () => {
    const t = setup({ card: true });
    // The parent's branch never reaches origin again: it was deleted when
    // the parent was dropped, and GitHub moved the PR to main.
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/parent-gone' WHERE id = ?`
    ).run(t.task);
    const child = stackOn(t, "dropped", "feature/parent-gone");
    S.pr = { ...S.pr!, base: "main" };

    const { text, runs } = await reviewNow(t.w);
    expect(text).toMatch(/: pass/);
    // The review and the scope check both read the diff against main.
    expect(runs[0].prompt).toContain("A src/a.ts");
    expect(runs[1].prompt).toContain("A src/a.ts");
    expect(getCheck(t.task, t.sha, "scope")?.status).toBe("pass");
    // The task and its stack item now say what GitHub says.
    expect(baseOf(t.task)).toBe("main");
    expect(child().base_branch).toBe("main");

    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
  });

  it("follows a PR on main when the task's recorded base was another task's branch, since dropped", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/other-gone' WHERE id = ?`
    ).run(t.task);
    S.pr = { ...S.pr!, base: "main" };
    const { text } = await reviewNow(t.w);
    expect(text).toMatch(/: pass/);
    expect(baseOf(t.task)).toBe("main");
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
  });

  it("still refuses an unrelated base when the recorded one is a dropped branch", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/other-gone' WHERE id = ?`
    ).run(t.task);
    S.pr = { ...S.pr!, base: "feature/elsewhere" };
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /targets feature\/elsewhere, not its base feature\/other-gone/
    );
    expect(baseOf(t.task)).toBe("feature/other-gone");
    expect(merges).toEqual([]);
  });

  it("merges a forwarded sign-off judged against the default branch though this row's base is stale", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/other-gone' WHERE id = ?`
    ).run(t.task);
    S.pr = { ...S.pr!, base: "main" };
    const { signOffTask } = await import("@/lib/tasks/finish");
    await expect(
      signOffTask(t.task, { head: t.sha, base: "main" })
    ).resolves.toBe("squash");
    expect(baseOf(t.task)).toBe("main");
    expect(merges).toHaveLength(1);
  });

  it("refuses a forwarded sign-off judged against a base this task may not have", async () => {
    const t = setup();
    S.pr = { ...S.pr!, base: "feature/elsewhere" };
    const { signOffTask } = await import("@/lib/tasks/finish");
    await expect(
      signOffTask(t.task, { head: t.sha, base: "feature/elsewhere" })
    ).rejects.toThrow(/isn't a base add-a may merge into/);
    expect(merges).toEqual([]);
  });

  it("keeps a merged parent's child on its branch until the restack moves it", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/parent-merged' WHERE id = ?`
    ).run(t.task);
    const child = stackOn(t, "merged", "feature/parent-merged");
    S.pr = { ...S.pr!, base: "main" };
    await reviewNow(t.w);
    expect(baseOf(t.task)).toBe("main");
    expect(child().base_branch).toBe("feature/parent-merged");
    await expect(t.signOff()).rejects.toThrow(/never moved off its branch/);
    expect(merges).toEqual([]);
  });

  it("records no base from a closed PR, a bad name, or a branch the task picked", async () => {
    const t = setup();
    const { prFor } = await import("@/lib/tasks/session");
    const task = () => getTaskSession(t.task);
    S.pr = { ...S.pr!, state: "CLOSED", base: "develop" };
    await prFor(task(), true);
    expect(baseOf(t.task)).toBe("main");
    S.pr = { ...S.pr!, state: "OPEN", base: "$(touch x)" };
    await prFor(task(), true);
    expect(baseOf(t.task)).toBe("main");
    // Retargeted to a branch of the task's own choosing: not followed, and
    // the gates refuse it.
    S.pr = { ...S.pr!, base: "feature/elsewhere" };
    await prFor(task(), true);
    expect(baseOf(t.task)).toBe("main");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /targets feature\/elsewhere, not its base main/
    );
    expect(merges).toEqual([]);
  });

  it("follows a retarget onto the stack parent's own branch", async () => {
    const t = setup();
    const child = stackOn(t, "pr", "feature/parent-live");
    S.pr = { ...S.pr!, base: "feature/parent-live" };
    const { prFor } = await import("@/lib/tasks/session");
    await prFor(getTaskSession(t.task), true);
    expect(baseOf(t.task)).toBe("feature/parent-live");
    expect(child().base_branch).toBe("feature/parent-live");
  });

  it("voids an unspent approval when the PR's base moves", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/parent-gone' WHERE id = ?`
    ).run(t.task);
    stackOn(t, "dropped", "feature/parent-gone");
    await runTool(t.w, "ask_saad", {
      title: "Merge add-a despite the review?",
      detail: "The review blocks.",
      kind: "decision",
      task: "add-a",
      sha: t.sha,
    });
    const [raised] = openAsks(t.w);
    answerAsk(t.w, raised.id, { action: "approve" }, t.sha);
    expect(getAsk(t.w, raised.id)?.used_at).toBeNull();
    S.pr = { ...S.pr!, base: "main" };
    const { prFor } = await import("@/lib/tasks/session");
    await prFor(getTaskSession(t.task), true);
    expect(getAsk(t.w, raised.id)).toMatchObject({
      answer: "approve (void)",
      used_at: expect.any(String),
    });
    await expect(t.signOff()).rejects.toThrow(/review/);
    expect(merges).toEqual([]);
  });

  it("refuses a sign-off when the retarget is only learned while it runs", async () => {
    const t = setup();
    db.prepare(`UPDATE sessions SET base_branch = 'develop' WHERE id = ?`).run(
      t.task
    );
    await reviewNow(t.w);
    // GitHub moved the PR to the default branch since the checks ran.
    S.pr = { ...S.pr!, base: "main" };
    const { signOffTask } = await import("@/lib/tasks/finish");
    await expect(signOffTask(t.task)).rejects.toThrow(
      /targets main, not its base develop: its review and checks were for the old base/
    );
    expect(merges).toEqual([]);
  });

  it("refuses a sign-off whose PR was retargeted after it was judged", async () => {
    const t = setup();
    S.pr = { ...S.pr!, base: "feature/elsewhere" };
    const { signOffTask } = await import("@/lib/tasks/finish");
    await expect(signOffTask(t.task)).rejects.toThrow(
      /targets feature\/elsewhere, not its base main/
    );
    expect(merges).toEqual([]);
  });

  it("stops counting a review of the old base once the PR is retargeted", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/parent-gone' WHERE id = ?`
    ).run(t.task);
    stackOn(t, "dropped", "feature/parent-gone");
    await reviewNow(t.w);
    expect(getCheck(t.task, t.sha, "review")?.status).toBe("pass");
    S.pr = { ...S.pr!, base: "main" };
    await expect(t.signOff()).rejects.toThrow(
      new RegExp(`review: not yet, no review of ${t.sha.slice(0, 7)} yet`)
    );
    expect(getCheck(t.task, t.sha, "review")).toBeNull();
    expect(merges).toEqual([]);
  });

  it("doesn't store a verdict whose base moved while it ran", async () => {
    const t = setup();
    const r = reviewer("pass");
    const text = await review(t.w, "add-a", {
      wait: true,
      claude: async (run) => {
        db.prepare(
          `UPDATE sessions SET base_branch = 'release' WHERE id = ?`
        ).run(t.task);
        return r.claude(run);
      },
    });
    expect(text).toMatch(/couldn't run|base moved/);
    expect(getCheck(t.task, t.sha, "review")).toMatchObject({
      status: "error",
      detail: expect.stringContaining("moved from main to release"),
    });
  });

  it("refuses to judge against a stale base when origin can't be reached", async () => {
    const t = setup();
    git(t.repo, "remote", "set-url", "origin", path.join(t.repo, "gone.git"));
    await expect(
      fetchRefs(t.repo, { base_branch: "main", branch_name: "feature/t" })
    ).rejects.toThrow(/Couldn't fetch from origin/);
  });

  it("falls back to the default branch when the recorded base is gone on origin", async () => {
    const t = setup();
    const base = await fetchRefs(t.repo, {
      base_branch: "feature/parent-gone",
      branch_name: "feature/t",
    });
    expect(base).toBe("origin/main");
    expect(
      (await changedFiles(t.repo, base, t.sha)).map((f) => f.path)
    ).toEqual(["src/a.ts"]);
  });

  it("skips a deleted base's leftover tracking ref for the default branch", async () => {
    const t = setup();
    // origin/feature/stale is still in the clone, but origin dropped it.
    git(t.repo, "update-ref", "refs/remotes/origin/feature/stale", t.sha);
    expect(
      await fetchRefs(t.repo, {
        base_branch: "feature/stale",
        branch_name: "feature/t",
      })
    ).toBe("origin/main");
  });

  it("leaves a normal stacked PR on its parent's branch", async () => {
    const t = setup();
    git(t.repo, "checkout", "-qb", "feature/parent", "main");
    commit(t.repo, "p.ts", "export const p = 1;\n");
    git(t.repo, "checkout", "-qb", "feature/child");
    const head = commit(t.repo, "c.ts", "export const c = 1;\n");
    db.prepare(
      `UPDATE sessions SET branch_name = 'feature/child', base_branch = 'feature/parent' WHERE id = ?`
    ).run(t.task);
    const child = stackOn(t, "pr", "feature/parent");
    S.pr = { ...S.pr!, head, base: "feature/parent" };

    const { runs } = await reviewNow(t.w);
    expect(runs[0].prompt).toContain("A c.ts");
    expect(runs[0].prompt).not.toContain("p.ts");
    expect(baseOf(t.task)).toBe("feature/parent");
    expect(child().base_branch).toBe("feature/parent");
    // The stack gate still waits for the parent.
    await expect(t.signOff()).rejects.toThrow(
      /stacked on .*which has not merged/
    );
    expect(merges).toEqual([]);
  });
});
