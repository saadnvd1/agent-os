/**
 * A task's plan step: its first turn runs on the planning model and writes
 * the implementation plan to a file in the worktree; when that turn ends,
 * the same conversation switches to the implementation model (Claude Code
 * keeps the transcript across a model change, and a resume takes a new
 * model) and is told to follow the plan.
 */

import fs from "fs";
import path from "path";
import { db, type Session } from "../db";
import { enqueue } from "../chat/queued";
import { applySessionModel } from "./session-model";
import {
  resolveRole,
  sessionWorkspace,
  setSessionModel,
  taskOverride,
} from "./resolve";
import { ANTHROPIC } from "./roles";

export const PLAN_FILE = ".agentos/plan.md";

export function planPrompt(task: string): string {
  return `${task}

---
Plan first. This turn, only read and plan: write the implementation plan for the task above to \`${PLAN_FILE}\` in this worktree (what to change, file by file; the tests; how you'll verify it; anything ambiguous and the call you'd make). Change no other file, and don't commit, push or open a PR. End the turn once the plan is written: the implementation model takes over this conversation next and follows it.`;
}

export function implementPrompt(planned: boolean): string {
  return planned
    ? `The plan is in \`${PLAN_FILE}\`. Implement it now, finishing the task as its instructions above say. Where the plan turns out wrong, do what's right and say so.`
    : `No plan was written to \`${PLAN_FILE}\`. Plan briefly, then implement the task, finishing it as its instructions above say.`;
}

// The worktree's plan folder, kept out of git by its own .gitignore.
export function preparePlanDir(worktree: string): void {
  const dir = path.join(worktree, path.dirname(PLAN_FILE));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n");
}

export const implementMessageId = (sessionId: string) =>
  `implement-${sessionId}`;

// Called when a chat goes idle. A task whose plan turn has ended (it has a
// recorded plan turn) moves to implementing, once, and the implementation
// message is queued under a fixed id, which a restart sends rather than
// repeats.
export async function handoffAfterPlan(
  sessionId: string,
  send: (sessionId: string, id: string) => Promise<void>
): Promise<boolean> {
  const planned = db
    .prepare(
      `SELECT 1 FROM chat_turns WHERE session_id = ? AND role = 'plan' LIMIT 1`
    )
    .get(sessionId);
  if (!planned) return false;
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
  if (s?.plan_phase !== "planning" || !s.worktree_path) return false;
  const routed = resolveRole("implement", {
    workspaceId: sessionWorkspace(s),
    override: taskOverride(s),
  });
  const id = implementMessageId(sessionId);
  // The phase, the model and the message in one go: a restart part-way
  // finds either none of them or all, and sends the message on the new model.
  const claimed = db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE sessions SET plan_phase = 'implementing'
         WHERE id = ? AND plan_phase = 'planning' AND task_status = 'running'`
      )
      .run(sessionId).changes;
    if (!changed) return false;
    setSessionModel(sessionId, routed);
    enqueue(sessionId, {
      id,
      text: implementPrompt(
        fs.existsSync(path.join(s.worktree_path!, PLAN_FILE))
      ),
      origin: { kind: "decision", label: "Plan step" },
    });
    return true;
  })();
  if (!claimed) return false;
  await applySessionModel(sessionId, s.model_provider ?? ANTHROPIC, routed);
  await send(sessionId, id);
  return true;
}
