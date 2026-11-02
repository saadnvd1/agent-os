import "./armed.test-helpers";
import { describe, expect, it } from "vitest";
import {
  S,
  armedAt,
  armedDeps,
  db,
  events,
  judge,
  mergeArmed,
  merges,
  runTool,
  setup,
} from "./armed.test-helpers";
import { autoArmFast, followFastMerges } from "./fast-lane";
import { reviewAt, taskReviewTarget } from "./review";
import { getCheck } from "./checks";

const session = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Parameters<
    typeof judge
  >[1];

// A fast project's task whose PR is open with CI still running and no review.
function fastTask() {
  const t = setup();
  const task = session(t.task);
  db.prepare(`UPDATE projects SET tier = 'fast' WHERE id = ?`).run(
    task.project_id
  );
  S.pr = { ...S.pr!, checks: "pending" };
  db.prepare(`DELETE FROM orchestrator_checks WHERE session_id = ?`).run(
    t.task
  );
  return t;
}

describe("the fast lane", () => {
  it("merges a fast task with CI pending and no review, arming it itself", async () => {
    const t = fastTask();
    const { deps, reviews } = armedDeps();
    await autoArmFast(t.w, t.facts());
    expect(armedAt(t.task)).not.toBeNull();
    await mergeArmed(t.w, t.facts(), deps);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
    expect(reviews).toEqual([]);
    expect(getCheck(t.task, t.sha, "review")).toBeNull();
    expect(events(t.w).at(-1)).toMatch(/Merged add-a/);
  });

  it("does not start a reviewer for a fast task", async () => {
    const t = fastTask();
    const text = await reviewAt(
      t.w,
      taskReviewTarget(session(t.task), S.pr!),
      t.sha
    );
    expect(text).toMatch(/fast project: no independent review/);
    expect(getCheck(t.task, t.sha, "review")).toBeNull();
  });

  it("merges the moment `arm` is called on a fast task", async () => {
    const t = fastTask();
    const text = await runTool(t.w, "arm", { task: "add-a" });
    expect(text).toMatch(/Merged add-a \(fast project\)/);
    expect(merges).toHaveLength(1);
  });

  it("arms a task once per PR, so a disarm sticks", async () => {
    const t = fastTask();
    await autoArmFast(t.w, t.facts());
    await runTool(t.w, "disarm", { task: "add-a" });
    await autoArmFast(t.w, t.facts());
    expect(armedAt(t.task)).toBeNull();
  });

  it("keeps a disarm made before the first auto-arm", async () => {
    const t = fastTask();
    await runTool(t.w, "disarm", { task: "add-a" });
    await autoArmFast(t.w, t.facts());
    expect(armedAt(t.task)).toBeNull();
  });

  it("still refuses an AI-attributed body, another base and the owner's hold", async () => {
    const t = fastTask();
    S.pr = { ...S.pr!, attribution: "footer" as never };
    const body = await judge(t.w, session(t.task), false, { count: false });
    expect(body).toMatchObject({ ok: false });
    expect(!body.ok && body.text).toMatch(/AI attribution/);

    S.pr = { ...S.pr!, attribution: null, base: "elsewhere" };
    const base = await judge(t.w, session(t.task));
    expect(!base.ok && base.text).toMatch(/targets elsewhere/);

    S.pr = { ...S.pr!, base: undefined };
    db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, escalated_at)
       VALUES (?, 'review', ?, 1, datetime('now'))`
    ).run(t.task, t.w);
    const held = await judge(t.w, session(t.task));
    expect(held.ok).toBe(false);
  });

  it("does not count a fast failure toward the loop guard", async () => {
    const t = fastTask();
    S.pr = { ...S.pr!, attribution: "footer" as never };
    for (let i = 0; i < 6; i++) await judge(t.w, session(t.task));
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM orchestrator_gate_failures WHERE session_id = ?`
        )
        .get(t.task)
    ).toEqual({ n: 0 });
  });

  it("tells the orchestrator once when CI fails after a fast merge", async () => {
    const t = fastTask();
    await runTool(t.w, "arm", { task: "add-a" });
    const failing = async () => [
      {
        __typename: "CheckRun",
        name: "build",
        status: "COMPLETED",
        conclusion: "FAILURE",
      },
    ];
    await followFastMerges(t.w, failing);
    db.prepare(
      `UPDATE fast_lane_tasks SET ci_checked_at = NULL, ci_done_at = NULL`
    ).run();
    await followFastMerges(t.w, failing);
    expect(
      events(t.w).filter((l) => /CI failed after the merge/.test(l))
    ).toHaveLength(1);
  });
});

describe("a production project", () => {
  it("still waits for CI and a review", async () => {
    const t = setup();
    S.pr = { ...S.pr!, checks: "pending" };
    const ci = await judge(t.w, session(t.task), false, { count: false });
    expect(!ci.ok && ci.text).toMatch(/ci:/);

    S.pr = { ...S.pr!, checks: "pass" };
    db.prepare(
      `DELETE FROM orchestrator_checks WHERE session_id = ? AND kind = 'review'`
    ).run(t.task);
    const { deps, reviews } = armedDeps();
    await runTool(t.w, "arm", { task: "add-a" });
    await mergeArmed(t.w, t.facts(), deps);
    expect(merges).toEqual([]);
    expect(reviews).toEqual([t.task]);
  });
});

describe("the project_tier tool", () => {
  it("lists, reads and sets a project's tier, and refuses a tier it doesn't know", async () => {
    const t = setup();
    const name = (
      db
        .prepare(`SELECT name FROM projects WHERE id = ?`)
        .get(session(t.task).project_id) as {
        name: string;
      }
    ).name;
    expect(await runTool(t.w, "project_tier", {})).toContain(
      `${name}: production`
    );
    expect(
      await runTool(t.w, "project_tier", { project: name, tier: "fast" })
    ).toMatch(/Set .* to fast/);
    expect(await runTool(t.w, "project_tier", { project: name })).toContain(
      `${name}: fast`
    );
    await expect(
      runTool(t.w, "project_tier", { project: name, tier: "staging" })
    ).rejects.toThrow();
  });
});
