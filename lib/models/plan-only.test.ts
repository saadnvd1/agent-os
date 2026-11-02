import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retireChat } = vi.hoisted(() => ({
  retireChat: vi.fn(async () => {}),
}));
vi.mock("../chat/runner", () => ({ retireChat, sendQueuedNow: vi.fn() }));

import { db, updateSessionRow } from "../db";
import { listAutoApprovals, setNoApprovals } from "../approvals/no-approvals";
import { listQueue } from "../chat/queued";
import {
  seedOrchestrator,
  seedSession,
  seedWorkspace,
} from "../orchestrator/testing";
import { pendingEvents } from "../orchestrator/events";
import { amendmentsOf } from "../orchestrator/amendments";
import { recordTurn } from "../usage/turns";
import { taskRouting } from "../tasks";
import { deriveTaskState, needsHuman } from "../tasks/state";
import { taskPlan } from "../tasks/plan-view";
import {
  PLAN_FILE,
  approvePlan,
  handoffAfterPlan,
  implementMessageId,
  planPrompt,
  preparePlanDir,
} from "./plan-step";
import { tempDir } from "@/lib/test-temp";

const turn = {
  costUsd: 0.5,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function planOnlyTask() {
  const { app } = seedWorkspace();
  seedOrchestrator("orch-1");
  const id = seedSession({
    projectId: app.id,
    name: "planned",
    view: "chat",
    task: true,
  });
  const worktree = tempDir("plan-only-");
  updateSessionRow(db, id, {
    worktree_path: worktree,
    model: "claude-opus-5-5",
    plan_phase: "planning",
    plan_only: 1,
    started_by: "orch-1",
  });
  recordTurn(
    { id, name: "planned", workspace_id: null },
    null,
    turn,
    Date.now(),
    null,
    () => null
  );
  preparePlanDir(worktree);
  fs.writeFileSync(
    path.join(worktree, PLAN_FILE),
    "# Plan\n\n## Files\n- a.ts\n- b.ts\n\n## Tests\n- c.test.ts\n"
  );
  return { id, worktree };
}

const row = (id: string) =>
  db
    .prepare(`SELECT model, plan_phase FROM session_rows WHERE id = ?`)
    .get(id) as {
    model: string;
    plan_phase: string;
  };

const workspaceOf = (id: string) =>
  (
    db
      .prepare(
        `SELECT p.workspace_id AS w FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`
      )
      .get(id) as { w: string }
  ).w;

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
  retireChat.mockClear();
});

describe("plan only", () => {
  it("plans even when one model does every role, and asks not to hand off", () => {
    expect(
      taskRouting(null, "chat", "anthropic/claude-sonnet-5-5", undefined, true)
    ).toMatchObject({ plan: true, planOnly: true });
    expect(taskRouting(null, "chat", undefined, undefined, true).planOnly).toBe(
      true
    );
    expect(taskRouting(null, "terminal", undefined, true, true)).toMatchObject({
      plan: false,
      planOnly: false,
    });
    expect(planPrompt("Build X", true)).toContain("waits for approval");
    expect(planPrompt("Build X")).toContain("takes over this conversation");
  });

  it("still stops at the plan and waits for approve_plan in No approvals mode", async () => {
    const { id, worktree } = planOnlyTask();
    setNoApprovals(true);
    try {
      const send = vi.fn(async () => {});
      expect(await handoffAfterPlan(id, send)).toBe(true);
      expect(row(id)).toEqual({
        model: "claude-opus-5-5",
        plan_phase: "awaiting",
      });
      expect(send).not.toHaveBeenCalled();
      const events = pendingEvents(workspaceOf(id)).filter(
        (e) => e.subject === id
      );
      expect(events[0].line).toContain(path.join(worktree, PLAN_FILE));
      expect(events[0].line).toContain("waiting for approval");
      expect(events[0].line).not.toContain("implementing on");
      expect(
        listAutoApprovals(50).some(
          (a) => a.source === "plan" && a.session_id === id
        )
      ).toBe(false);
    } finally {
      setNoApprovals(false);
    }
  });

  it("waits for approval instead of implementing", async () => {
    const { id, worktree } = planOnlyTask();
    const send = vi.fn(async () => {});
    expect(await handoffAfterPlan(id, send)).toBe(true);
    expect(row(id)).toEqual({
      model: "claude-opus-5-5",
      plan_phase: "awaiting",
    });
    expect(listQueue(id)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(retireChat).toHaveBeenCalledWith(id);

    const events = pendingEvents(workspaceOf(id)).filter(
      (e) => e.subject === id
    );
    expect(events).toHaveLength(1);
    expect(events[0].line).toContain(path.join(worktree, PLAN_FILE));
    expect(events[0].line).toContain("waiting for approval");
    expect(events[0].line).toContain("- a.ts");
    expect(events[0].line).not.toContain("implementing on");

    // The next idle doesn't announce again or queue anything.
    expect(await handoffAfterPlan(id, send)).toBe(false);
    expect(
      pendingEvents(workspaceOf(id)).filter((e) => e.subject === id)
    ).toHaveLength(1);
    expect(listQueue(id)).toEqual([]);
  });

  it("shows as plan ready, not blocked or needing a person", async () => {
    const { id } = planOnlyTask();
    await handoffAfterPlan(id, async () => {});
    const s = db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(id) as never;
    expect(taskPlan(s)).toMatchObject({ status: "ready", source: "step" });
    const base = {
      taskStatus: "running" as const,
      pr: null,
      blocked: false,
      planReady: true,
    };
    // No worker (released) reads as waiting, never as exited or needs-input.
    for (const sessionStatus of ["waiting", "dead", undefined] as const)
      expect(deriveTaskState({ ...base, sessionStatus })).toBe("plan-ready");
    expect(needsHuman("plan-ready")).toBe(false);
    expect(
      deriveTaskState({ ...base, sessionStatus: "waiting", blocked: true })
    ).toBe("blocked");
  });

  it("every approval is on the brief, a plain Approve included, so the review judges the PR as the implementation", async () => {
    const { id } = planOnlyTask();
    await handoffAfterPlan(id, async () => {});
    await approvePlan(id, undefined, async () => {});
    expect(amendmentsOf(id).map((a) => [a.kind, a.text])).toEqual([
      ["approval", "The owner approved the plan; implement it as planned."],
    ]);
    const orch = planOnlyTask();
    await handoffAfterPlan(orch.id, async () => {});
    await approvePlan(orch.id, undefined, async () => {}, "orchestrator");
    expect(amendmentsOf(orch.id)[0]).toMatchObject({
      kind: "approval",
      text: "The orchestrator approved the plan; implement it as planned.",
    });
    const auto = planOnlyTask();
    await handoffAfterPlan(auto.id, async () => {});
    await approvePlan(auto.id, undefined, async () => {}, "no-approvals");
    expect(amendmentsOf(auto.id)[0].text).toContain("approved automatically");
  });

  it("approves once, on the implementation model, with an amendment recorded", async () => {
    const { id } = planOnlyTask();
    await handoffAfterPlan(id, async () => {});
    const send = vi.fn(async () => {});

    const out = await approvePlan(id, " also cover the CLI ", send);
    expect(out.ref).toContain("claude-sonnet-5-5");
    expect(row(id)).toEqual({
      model: "claude-sonnet-5-5",
      plan_phase: "implementing",
    });
    const queued = listQueue(id).filter((m) => m.id === implementMessageId(id));
    expect(queued).toHaveLength(1);
    expect(queued[0].text).toContain(`The plan is in \`${PLAN_FILE}\``);
    expect(queued[0].text).toContain("also cover the CLI");
    expect(send).toHaveBeenCalledOnce();
    expect(amendmentsOf(id).map((a) => a.text)).toEqual(["also cover the CLI"]);

    await expect(approvePlan(id, undefined, send)).rejects.toThrow(
      /isn't waiting for plan approval/
    );
    expect(send).toHaveBeenCalledOnce();
    expect(
      listQueue(id).filter((m) => m.id === implementMessageId(id))
    ).toHaveLength(1);
  });

  it("refuses to approve a task that isn't waiting", async () => {
    const { id } = planOnlyTask();
    await expect(approvePlan(id, undefined, async () => {})).rejects.toThrow(
      /isn't waiting/
    );
    await expect(
      approvePlan("missing", undefined, async () => {})
    ).rejects.toThrow(/isn't waiting/);
  });

  it("keeps waiting across a restart and still approves", async () => {
    const { id } = planOnlyTask();
    await handoffAfterPlan(id, async () => {});
    // A restart keeps only the database: the reattached chat going idle
    // finds the phase already past planning and does nothing.
    const send = vi.fn(async () => {});
    expect(await handoffAfterPlan(id, send)).toBe(false);
    expect(row(id).plan_phase).toBe("awaiting");
    expect(send).not.toHaveBeenCalled();
    await approvePlan(id, undefined, send);
    expect(row(id).plan_phase).toBe("implementing");
    expect(send).toHaveBeenCalledOnce();
  });
});
