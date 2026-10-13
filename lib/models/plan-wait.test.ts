import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { retireChat } = vi.hoisted(() => ({
  retireChat: vi.fn(async () => {}),
}));
vi.mock("../chat/runner", () => ({ retireChat, sendQueuedNow: vi.fn() }));

import { db } from "../db";
import { listQueue } from "../chat/queued";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { pendingEvents } from "../orchestrator/events";
import { recordTurn } from "../usage/turns";
import {
  PLAN_FILE,
  PLAN_RETRY_PROMPT,
  handoffAfterPlan,
  implementMessageId,
  planPrompt,
  planRetryMessageId,
  preparePlanDir,
} from "./plan-step";

const turn = {
  costUsd: 0.5,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function task(planOnly: boolean) {
  const { app } = seedWorkspace();
  const id = seedSession({
    projectId: app.id,
    name: "planned",
    view: "chat",
    task: true,
  });
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "plan-wait-"));
  db.prepare(
    `UPDATE sessions SET worktree_path = ?, model = 'claude-opus-5-5', plan_phase = 'planning', plan_only = ?, started_by = 'orch-1' WHERE id = ?`
  ).run(worktree, planOnly ? 1 : 0, id);
  recordTurn(
    { id, name: "planned", workspace_id: null },
    null,
    turn,
    Date.now(),
    null,
    () => null
  );
  preparePlanDir(worktree);
  return { id, worktree };
}

const phase = (id: string) =>
  (
    db.prepare(`SELECT plan_phase FROM sessions WHERE id = ?`).get(id) as {
      plan_phase: string;
    }
  ).plan_phase;
const writePlan = (worktree: string) =>
  fs.writeFileSync(path.join(worktree, PLAN_FILE), "# Plan\n- a.ts\n");
const eventLines = (id: string) =>
  db
    .prepare(
      `SELECT p.workspace_id AS w FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`
    )
    .all(id)
    .flatMap((r) =>
      pendingEvents((r as { w: string }).w)
        .filter((e) => e.subject === id)
        .map((e) => e.line)
    );

beforeEach(() => retireChat.mockClear());
afterEach(() => vi.useRealTimers());

describe.each([
  ["plan:true", false, "implementing"],
  ["plan_only", true, "awaiting"],
])("%s task's planning turn", (_name, planOnly, final) => {
  it("hands off at once when the plan was written", async () => {
    const { id, worktree } = task(planOnly);
    writePlan(worktree);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send, { backgroundRunning: () => true });
    expect(phase(id)).toBe(final);
    expect(listQueue(id).some((m) => m.id === planRetryMessageId(id))).toBe(
      false
    );
    expect(eventLines(id)[0]).toContain("plan written");
    expect(eventLines(id)[0]).not.toContain("asked once more");
  });

  it("waits while background work runs, then hands off when a later turn writes the plan", async () => {
    const { id, worktree } = task(planOnly);
    const send = vi.fn(async () => {});
    const env = { backgroundRunning: () => true };
    expect(await handoffAfterPlan(id, send, env)).toBe(false);
    expect(phase(id)).toBe("planning");
    expect(send).not.toHaveBeenCalled();
    expect(listQueue(id)).toEqual([]);
    writePlan(worktree);
    await handoffAfterPlan(id, send, { backgroundRunning: () => false });
    expect(phase(id)).toBe(final);
    expect(eventLines(id)[0]).toContain("plan written");
  });

  it("re-prompts once when nothing runs, and hands off when that writes the plan", async () => {
    const { id, worktree } = task(planOnly);
    const send = vi.fn(async () => {});
    expect(await handoffAfterPlan(id, send)).toBe(false);
    expect(phase(id)).toBe("planning");
    expect(send).toHaveBeenCalledWith(id, planRetryMessageId(id));
    expect(
      listQueue(id).find((m) => m.id === planRetryMessageId(id))?.text
    ).toBe(PLAN_RETRY_PROMPT);
    writePlan(worktree);
    await handoffAfterPlan(id, send);
    expect(phase(id)).toBe(final);
    expect(eventLines(id)[0]).toContain("plan written");
    expect(eventLines(id)[0]).not.toContain("no plan file");
  });

  it("falls back, saying it was retried, when the re-prompt writes nothing", async () => {
    const { id } = task(planOnly);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send);
    await handoffAfterPlan(id, send);
    expect(phase(id)).toBe(final);
    expect(send).toHaveBeenCalledTimes(planOnly ? 1 : 2);
    expect(eventLines(id)[0]).toContain("no plan file was written");
    expect(eventLines(id)[0]).toContain("asked once more");
    if (!planOnly)
      expect(listQueue(id).some((m) => m.id === implementMessageId(id))).toBe(
        true
      );
  });

  it("treats background work past the timeout as nothing running", async () => {
    const { id } = task(planOnly);
    const send = vi.fn(async () => {});
    let t = 1_000;
    const env = { backgroundRunning: () => true, waitMs: 1000, now: () => t };
    expect(await handoffAfterPlan(id, send, env)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    t += 1001;
    await handoffAfterPlan(id, send, env);
    expect(send).toHaveBeenCalledWith(id, planRetryMessageId(id));
    expect(phase(id)).toBe("planning");
  });

  it("re-checks on a timer when no further turn comes", async () => {
    vi.useFakeTimers();
    const { id } = task(planOnly);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send, {
      backgroundRunning: () => true,
      waitMs: 1000,
    });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(send).toHaveBeenCalledWith(id, planRetryMessageId(id));
  });
});

describe("planning prompt", () => {
  it("tells the planner to stay in the turn while its background work runs", () => {
    expect(planPrompt("X")).toContain(
      "Don't end your turn while subagents or background commands you started are still running"
    );
  });
});
