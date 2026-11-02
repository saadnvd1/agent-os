import "./armed.test-helpers";
import { describe, expect, it } from "vitest";
import {
  LOOP_GUARD_COMMITS,
  S,
  armedAt,
  armedDeps,
  commit,
  events,
  failureOf,
  mergeArmed,
  merges,
  openAsks,
  putCheck,
  runTool,
  setup,
} from "./armed.test-helpers";

describe("arm", () => {
  describe("the loop guard", () => {
    // A new head of the PR, CI settled on it, reviewed with this finding
    // (null: passed), then the armed watcher looks.
    async function head(
      t: ReturnType<typeof setup>,
      n: number,
      finding: string | null
    ) {
      const sha = commit(t.repo, "src/c.ts", `c ${n}\n`);
      S.pr = { ...S.pr!, head: sha };
      t.put("ci", "pass", sha);
      putCheck({
        workspaceId: t.w,
        sessionId: t.task,
        sha,
        kind: "review",
        status: finding ? "block" : "pass",
        detail: finding ? `One bug.\n- [blocking] ${finding}` : "Looks right.",
      });
      await mergeArmed(t.w, t.facts(), armedDeps().deps, n * 60_000);
      return sha;
    }

    it("keeps a task armed through three failed commits and merges it on a passing fourth", async () => {
      const t = setup();
      await runTool(t.w, "arm", { task: "add-a" });
      for (let n = 1; n < LOOP_GUARD_COMMITS; n++)
        await head(t, n, `src/b.ts:${n}: bug ${n}`);
      expect(merges).toEqual([]);
      expect(armedAt(t.task)).not.toBeNull();
      expect(failureOf(t.task, "review")).toMatchObject({
        streak: 3,
        escalated_at: null,
      });
      expect(openAsks(t.w)).toEqual([]);
      expect(events(t.w).at(-1)).toMatch(
        /stays armed[\s\S]*review failed \(again, 3 of 4 in a row\)/
      );
      const fourth = await head(t, LOOP_GUARD_COMMITS, null);
      expect(merges).toEqual([
        ["pr", "merge", "7", "--squash", "--match-head-commit", fourth],
      ]);
    });

    it("sends the task to the owner when the gate fails on four commits in a row", async () => {
      const t = setup();
      await runTool(t.w, "arm", { task: "add-a" });
      const shas: string[] = [];
      for (let n = 1; n <= LOOP_GUARD_COMMITS; n++)
        shas.push(await head(t, n, `src/b.ts:${n}: bug ${n}`));
      expect(merges).toEqual([]);
      expect(armedAt(t.task)).toBeNull();
      expect(events(t.w).at(-1)).toMatch(
        /armed merge stopped and disarmed, it went to the owner/
      );
      const why = failureOf(t.task, "review")?.escalated_why ?? "";
      expect(why).toMatch(
        /^the review gate failed on 4 commits in a row \(the loop guard stops at 4\)/
      );
      // Each failure listed, oldest first.
      expect(
        why
          .split("\n")
          .slice(1)
          .map((l) => l.slice(2, 9))
      ).toEqual(shas.map((s) => s.slice(0, 7)));
    });

    it("sends the task to the owner when the same failure repeats on the next commit", async () => {
      const t = setup();
      await runTool(t.w, "arm", { task: "add-a" });
      await head(t, 1, "src/b.ts:5: off by one");
      expect(armedAt(t.task)).not.toBeNull();
      // Worded differently, same place: the same finding.
      await head(t, 2, "src/b.ts:5: still off by one at the loop end");
      expect(armedAt(t.task)).toBeNull();
      expect(failureOf(t.task, "review")?.escalated_why).toMatch(
        /^the review gate failed the same way on two commits in a row \(src\/b\.ts:5\)/
      );
    });

    it("keeps going when the second commit fails differently", async () => {
      const t = setup();
      await runTool(t.w, "arm", { task: "add-a" });
      await head(t, 1, "src/b.ts:5: off by one");
      await head(t, 2, "src/b.ts:9: null check missing");
      expect(armedAt(t.task)).not.toBeNull();
      expect(failureOf(t.task, "review")).toMatchObject({
        streak: 2,
        repeated: 0,
        escalated_at: null,
      });
      expect(openAsks(t.w)).toEqual([]);
    });
  });
});
