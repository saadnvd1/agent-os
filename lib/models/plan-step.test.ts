import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, updateSessionRow } from "../db";
import { listQueue } from "../chat/queued";
import {
  seedOrchestrator,
  seedSession,
  seedWorkspace,
} from "../orchestrator/testing";
import { pendingEvents } from "../orchestrator/events";
import { recordTurn } from "../usage/turns";
import { taskRouting } from "../tasks";
import { setModelSettings } from "./config";
import {
  PLAN_FILE,
  handoffAfterPlan,
  planSummary,
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

function planningTask() {
  const { app } = seedWorkspace();
  const id = seedSession({
    projectId: app.id,
    name: "planned",
    view: "chat",
    task: true,
  });
  const worktree = tempDir("plan-step-");
  updateSessionRow(db, id, {
    worktree_path: worktree,
    model: "claude-opus-5-5",
    plan_phase: "planning",
  });
  return { id, worktree };
}

const row = (id: string) =>
  db
    .prepare(
      `SELECT model, model_provider, plan_phase FROM session_rows WHERE id = ?`
    )
    .get(id);

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
});

describe("plan then implement", () => {
  it("plans first only as a chat, and only when the two roles differ", () => {
    expect(taskRouting(null, "chat", undefined)).toMatchObject({
      plan: true,
      first: { model: "claude-opus-5-5", role: "plan" },
    });
    expect(taskRouting(null, "terminal", undefined)).toMatchObject({
      plan: false,
      first: { model: "claude-sonnet-5-5", role: "implement" },
    });
    // One model for every role: nothing to hand off to.
    expect(taskRouting(null, "chat", "anthropic/claude-sonnet-5-5").plan).toBe(
      false
    );
    expect(taskRouting(null, "chat", undefined, false).plan).toBe(false);
    setModelSettings({ planStep: false });
    expect(taskRouting(null, "chat", undefined).plan).toBe(false);
  });

  it("asks for the plan in a file the worktree's git ignores", () => {
    const { worktree } = planningTask();
    preparePlanDir(worktree);
    expect(
      fs.readFileSync(path.join(worktree, ".agentos", ".gitignore"), "utf8")
    ).toBe("*\n");
    expect(planPrompt("Build X")).toMatch(/^Build X\n/);
    expect(planPrompt("Build X")).toContain(PLAN_FILE);
  });

  it("hands the conversation to the implementation model once the plan turn ends", async () => {
    const { id, worktree } = planningTask();
    const send = vi.fn(async () => {});
    // Idle before any plan turn (the worker just started): nothing yet.
    expect(await handoffAfterPlan(id, send)).toBe(false);

    recordTurn(
      { id, name: "planned", workspace_id: null },
      null,
      turn,
      Date.now(),
      2000,
      () => null
    );
    const recorded = db
      .prepare(
        `SELECT role, model, provider, duration_ms FROM chat_turns WHERE session_id = ?`
      )
      .get(id);
    expect(recorded).toEqual({
      role: "plan",
      model: "claude-opus-5-5",
      provider: "anthropic",
      duration_ms: 2000,
    });
    preparePlanDir(worktree);
    fs.writeFileSync(path.join(worktree, PLAN_FILE), "1. do it\n");

    expect(await handoffAfterPlan(id, send)).toBe(true);
    expect(row(id)).toEqual({
      model: "claude-sonnet-5-5",
      model_provider: null,
      plan_phase: "implementing",
    });
    const queued = listQueue(id).find((m) => m.id === implementMessageId(id));
    expect(queued?.text).toContain(`The plan is in \`${PLAN_FILE}\``);
    expect(send).toHaveBeenCalledWith(id, implementMessageId(id));

    // Once: the next idle (the implementation's own turns) changes nothing.
    expect(await handoffAfterPlan(id, send)).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    recordTurn(
      { id, name: "planned", workspace_id: null },
      turn,
      { ...turn, costUsd: 1, inputTokens: 300 },
      Date.now(),
      null,
      () => null
    );
    const roles = db
      .prepare(
        `SELECT role, model FROM chat_turns WHERE session_id = ? ORDER BY id`
      )
      .all(id);
    expect(roles).toEqual([
      { role: "plan", model: "claude-opus-5-5" },
      { role: "implement", model: "claude-sonnet-5-5" },
    ]);
  });

  it("says so when no plan was written", async () => {
    const { id } = planningTask();
    recordTurn(
      { id, name: "planned", workspace_id: null },
      null,
      turn,
      Date.now(),
      null,
      () => null
    );
    // The first idle asks once more for the plan; the second gives up.
    await handoffAfterPlan(id, async () => {});
    await handoffAfterPlan(id, async () => {});
    const queued = listQueue(id).find((m) => m.id === implementMessageId(id));
    expect(queued?.text).toContain("No plan was written");
  });

  describe("telling the orchestrator", () => {
    const finishPlan = async (id: string, worktree: string, text?: string) => {
      recordTurn(
        { id, name: "planned", workspace_id: null },
        null,
        turn,
        Date.now(),
        null,
        () => null
      );
      preparePlanDir(worktree);
      if (text !== undefined)
        fs.writeFileSync(path.join(worktree, PLAN_FILE), text);
      await handoffAfterPlan(id, async () => {});
      if (text === undefined) await handoffAfterPlan(id, async () => {});
    };
    const startedBy = (id: string, by: string | null) => {
      if (by) seedOrchestrator(by);
      return db
        .prepare(`UPDATE sessions SET started_by = ? WHERE id = ?`)
        .run(by, id);
    };
    const eventsFor = (id: string) =>
      pendingEvents(workspaceOf(id)).filter((e) => e.subject === id);
    const workspaceOf = (id: string) =>
      (
        db
          .prepare(
            `SELECT p.workspace_id AS w FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`
          )
          .get(id) as { w: string }
      ).w;

    it("sends one event with the plan's path and a short summary", async () => {
      const { id, worktree } = planningTask();
      startedBy(id, "orch-1");
      await finishPlan(
        id,
        worktree,
        "# Plan\n\n## Files\n- a.ts\n- b.ts\n\n## Tests\n- c.test.ts\n- d.test.ts\n- e.test.ts\n"
      );
      const events = eventsFor(id);
      expect(events).toHaveLength(1);
      expect(events[0].line).toContain(path.join(worktree, PLAN_FILE));
      expect(events[0].line).toContain("- a.ts");
      expect(events[0].line.split("\n").length).toBeLessThanOrEqual(7);
      // A repeat idle doesn't add another.
      await handoffAfterPlan(id, async () => {});
      expect(eventsFor(id)).toHaveLength(1);
    });

    it("says so when the plan file is missing", async () => {
      const { id, worktree } = planningTask();
      startedBy(id, "orch-1");
      await finishPlan(id, worktree);
      expect(eventsFor(id)[0].line).toContain("no plan file was written");
      expect(eventsFor(id)[0].line).toContain("asked once more");
    });

    it("stays quiet for a task Saad started", async () => {
      const { id, worktree } = planningTask();
      await finishPlan(id, worktree, "# Plan\n- a\n");
      expect(eventsFor(id)).toEqual([]);
    });
  });

  it("summarises a plan in at most five short lines", () => {
    const text = [
      "# Plan",
      "",
      "```",
      "- inside a fence",
      "```",
      "| a | b |",
      "- " + "x".repeat(300),
      "- two",
      "- three",
      "- four",
      "- five",
      "- six",
    ].join("\n");
    const lines = planSummary(text);
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.length <= 120)).toBe(true);
    expect(lines.join("\n")).not.toContain("inside a fence");
    expect(planSummary("Just one sentence of prose.")).toEqual([
      "Just one sentence of prose.",
    ]);
  });
});
