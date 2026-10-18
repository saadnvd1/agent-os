import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseline, observeCi, pendingCi } from "./ci";
import { ciSlow } from "./detectors";
import { config, facts } from "./fixtures";
import { setPr } from "@/lib/db/session-parts/prs";
import { setTask } from "@/lib/db/session-parts/tasks";
import { MIN } from "./types";

const NOW = Date.parse("2026-10-14T18:00:00Z");
type F = Parameters<typeof observeCi>[1][number];
const f = (
  checks: "pending" | "pass" | "fail",
  head = "aaa",
  state: "OPEN" | "MERGED" = "OPEN"
): F => ({
  project: "api",
  task: {
    state: "review",
    blocked: null,
    pr: { number: 7, url: "u", state, checks, head },
  },
});

beforeEach(() => {
  db.exec(`DELETE FROM ci_runs`);
  db.exec(`DELETE FROM sessions WHERE id = 'ci-s'`);
  db.exec(`DELETE FROM projects WHERE id = 'ci-p'`);
});

function sessionWith(prStatus: string, taskStatus: string | null = null) {
  db.prepare(
    `INSERT INTO projects (id, name, working_directory) VALUES ('ci-p', 'api', '/tmp/api')`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id)
     VALUES ('ci-s', 's', 'ci-s', '/tmp', 'ci-p')`
  ).run();
  if (taskStatus) setTask(db, "ci-s", { task_status: taskStatus as "merged" });
  setPr(db, "ci-s", { pr_number: 7, pr_status: prStatus as "open" });
}

describe("CI runs", () => {
  it("starts timing at the first pending look and stops when it settles", () => {
    observeCi("w", [f("pending")], NOW);
    observeCi("w", [f("pending")], NOW + 5 * MIN);
    expect(pendingCi(NOW + 6 * MIN)).toMatchObject([
      { prNumber: 7, pendingSince: NOW, workspaceId: "w" },
    ]);
    observeCi("w", [f("pass")], NOW + 8 * MIN);
    expect(pendingCi(NOW + 9 * MIN)).toEqual([]);
    expect(baseline("api")).toEqual([8 * MIN]);
  });

  it("drops the run on an older head when a new one is pushed", () => {
    observeCi("w", [f("pending", "aaa")], NOW);
    observeCi("w", [f("pending", "bbb")], NOW + MIN);
    expect(pendingCi(NOW + 2 * MIN).map((r) => r.head)).toEqual(["bbb"]);
  });

  it("forgets a pending run once the PR is no longer open", () => {
    observeCi("w", [f("pending")], NOW);
    observeCi("w", [f("pending", "aaa", "MERGED")], NOW + MIN);
    expect(pendingCi(NOW + 2 * MIN)).toEqual([]);
  });

  it("ignores a run pending for over a day: that one is lost, not slow", () => {
    observeCi("w", [f("pending")], NOW);
    expect(pendingCi(NOW + 25 * 60 * MIN)).toEqual([]);
  });

  it("gives no alarm for a merged PR that was pending", () => {
    observeCi("w", [f("pending")], NOW);
    sessionWith("merged", "merged");
    expect(pendingCi(NOW + 58 * MIN)).toEqual([]);
    const ci = pendingCi(NOW + 58 * MIN);
    expect(ciSlow(facts({ ci, now: NOW + 58 * MIN }), config())).toEqual([]);
  });

  it("forgets a run whose PR left the workspace's facts", () => {
    observeCi("w", [f("pending")], NOW);
    observeCi("other", [], NOW + MIN);
    expect(pendingCi(NOW + 2 * MIN)).toHaveLength(1);
    observeCi("w", [], NOW + 2 * MIN);
    expect(pendingCi(NOW + 3 * MIN)).toEqual([]);
  });

  it("still alarms on an open PR's pending check past the threshold", () => {
    observeCi("w", [f("pending")], NOW);
    sessionWith("open", "running");
    const at = (min: number) =>
      ciSlow(
        facts({ ci: pendingCi(NOW + min * MIN), now: NOW + min * MIN }),
        config()
      );
    expect(at(10)).toEqual([]);
    expect(at(30)).toHaveLength(1);
  });
});
