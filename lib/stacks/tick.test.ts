import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { db, stackQueries as q } from "../db";
import { retryItem } from "./index";
import { seedStack } from "./testing";
import {
  finishedStatus,
  parentsToRestack,
  recoverAfterRestart,
  START_ATTEMPTS,
  tickStack,
  type TickDeps,
} from "./tick";
import { startItem } from "./start";

const repo = () => mkdtempSync(join(tmpdir(), "stack-tick-"));
const noRestack = { restack: vi.fn().mockResolvedValue(undefined) };

describe("starting items", () => {
  it("retries a failed start, then fails it, and Retry puts it and what it holds back", async () => {
    const s = seedStack(repo(), [
      { key: "A", status: "planned" },
      { key: "B", parent: "A", status: "planned" },
    ]);
    const start = vi.fn().mockRejectedValue(new Error("LumifyHub unreachable"));
    const deps: TickDeps = { start, ...noRestack };
    const tick = () => tickStack(q.get(db, s.stackId)!, deps);

    await tick();
    expect(s.item("A")).toMatchObject({ status: "planned", attempts: 1 });
    expect(s.item("A").error).toContain(`try 1 of ${START_ATTEMPTS}`);
    for (let n = 1; n < START_ATTEMPTS; n++) await tick();
    expect(s.item("A")).toMatchObject({
      status: "failed",
      attempts: START_ATTEMPTS,
    });
    await tick();
    expect(s.item("B").status).toBe("held");
    expect(start).toHaveBeenCalledTimes(START_ATTEMPTS);

    retryItem(s.stackId, s.item("A").id);
    expect(s.item("A")).toMatchObject({
      status: "planned",
      attempts: 0,
      error: null,
    });
    expect(s.item("B").status).toBe("planned");
  });

  it("keeps a hold the plan made when something else is retried", () => {
    const s = seedStack(repo(), [
      { key: "A", status: "failed" },
      { key: "B", parent: "A", status: "held" },
    ]);
    db.prepare(`UPDATE stack_items SET held_outside = 1 WHERE id = ?`).run(
      s.item("B").id
    );
    retryItem(s.stackId, s.item("A").id);
    expect(s.item("B").status).toBe("held");
  });

  it("links a card's running task instead of starting it twice", async () => {
    const s = seedStack(repo(), [{ key: "A", status: "planned" }]);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, lh_card_id, base_branch)
       VALUES ('existing-a', 'A', 'claude-x', '/tmp', 'running', ?, 'main')`
    ).run(s.item("A").lh_card_id);
    await startItem(q.get(db, s.stackId)!, s.item("A"));
    expect(s.item("A")).toMatchObject({
      status: "running",
      session_id: "existing-a",
    });
  });

  it("after a restart, links a claimed item's task or plans it again", () => {
    const s = seedStack(repo(), [
      { key: "R1", status: "planned" },
      { key: "R2", status: "planned", branch: "feature/r2" },
    ]);
    db.prepare(
      `UPDATE stack_items SET status = 'starting' WHERE stack_id = ?`
    ).run(s.stackId);
    q.update(db, s.stackId, {
      status: "landing",
      progress: "Merging R1 (1/2)",
    });
    recoverAfterRestart();
    expect(s.item("R1").status).toBe("planned");
    expect(s.item("R2")).toMatchObject({
      status: "running",
      session_id: s.session("R2"),
    });
    expect(q.get(db, s.stackId)).toMatchObject({
      status: "paused",
      progress: "Merging R1 (1/2)",
    });
    expect(q.get(db, s.stackId)!.error).toContain("Press Land to carry on");
  });
});

describe("a stack's end", () => {
  it("is landed once every card merged or was dropped, failed if one failed", async () => {
    const s = seedStack(repo(), [
      { key: "A", status: "merged" },
      { key: "B", status: "dropped" },
    ]);
    await tickStack(q.get(db, s.stackId)!, { start: vi.fn(), ...noRestack });
    expect(q.get(db, s.stackId)!.status).toBe("landed");
    expect(
      finishedStatus([{ ...s.item("A"), status: "failed" }, s.item("B")])
    ).toBe("failed");
    expect(finishedStatus([{ ...s.item("A"), status: "held" }])).toBeNull();
  });
});

describe("reconciliation", () => {
  it("restacks children left on a merged parent's branch, once per parent", () => {
    const s = seedStack(repo(), [
      { key: "P", status: "merged", branch: "feature/p" },
      {
        key: "C",
        parent: "P",
        status: "pr",
        branch: "feature/c",
        baseBranch: "feature/p",
        baseTip: "t",
      },
      {
        key: "D",
        parent: "P",
        status: "pr",
        branch: "feature/d",
        baseBranch: "feature/p",
        baseTip: "t",
      },
      {
        key: "E",
        parent: "P",
        status: "pr",
        branch: "feature/e",
        baseBranch: "main",
        baseTip: "t",
      },
    ]);
    const items = q.items(db, s.stackId);
    const branchOf = () => "feature/p";
    expect(parentsToRestack(items, branchOf).map((p) => p.ticket)).toEqual([
      "P",
    ]);
    // One needing a human, or already moved, isn't retried every minute.
    const settled = items.map((i) =>
      i.ticket === "E"
        ? i
        : { ...i, error: i.ticket === "P" ? null : "conflict" }
    );
    expect(parentsToRestack(settled, branchOf)).toEqual([]);
  });

  it("asks for the restack from the watcher's look", async () => {
    const s = seedStack(repo(), [
      { key: "P", status: "merged", branch: "feature/p" },
      {
        key: "C",
        parent: "P",
        status: "pr",
        baseBranch: "feature/p",
        baseTip: "t",
      },
    ]);
    const restack = vi.fn().mockResolvedValue(undefined);
    await tickStack(q.get(db, s.stackId)!, { start: vi.fn(), restack });
    expect(restack).toHaveBeenCalledTimes(1);
    expect(restack.mock.calls[0][0].ticket).toBe("P");
  });
});
