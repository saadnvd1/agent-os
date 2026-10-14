/**
 * Resuming a task on another model: its conversation and worktree carry on,
 * only the model (and maybe the provider) under it changes. The choice is
 * kept as the task's own override, so later turns and restarts stay on it.
 */

import { db, type Session } from "../db";
import { chatState, sendChat } from "../chat/runner";
import { launchPending } from "../tasks/launch-gate";
import { killTmux } from "../tasks/start";
import { launchClaude } from "../agents/launch";
import { switchSessionModel } from "./session-model";
import {
  parseOverride,
  resolveRole,
  sessionWorkspace,
  setSessionModel,
  taskOverride,
  type ModelOverride,
} from "./resolve";
import { sessionRole } from "./session-role";

export const RESUME_MESSAGE =
  "You were paused. Carry on where you left off: check the worktree and the conversation above for where things stand, then finish the task.";

// A per-role map adds to the one it has; one model replaces it.
export function mergeOverride(
  before: ModelOverride | null,
  next: ModelOverride
): ModelOverride {
  if (typeof next === "string" || !before) return next;
  if (typeof before === "string") return next;
  return { ...before, ...next };
}

export interface ResumeResult {
  ref: string;
  // Whether a message went to its agent now: a task still setting up, or
  // held, starts on the new model by itself.
  resumed: boolean;
}

export async function resumeOnModel(
  sessionId: string,
  model: unknown,
  message = RESUME_MESSAGE
): Promise<ResumeResult> {
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
  if (!s?.task_status) throw new Error("No such task");
  if (s.task_status !== "running")
    throw new Error(
      `That task is ${s.task_status}; only a running one resumes`
    );
  const next = parseOverride(model);
  if (!next) throw new Error("Pick a model");
  const override = mergeOverride(taskOverride(s), next);
  const routed = resolveRole(sessionRole(s), {
    workspaceId: sessionWorkspace(s),
    override,
  });
  const state = s.view === "chat" ? chatState(sessionId) : null;
  if (state === "running" || state === "waiting")
    throw new Error(
      "It's mid-turn: stop it first, or wait for the turn to end"
    );
  db.prepare(`UPDATE sessions SET model_overrides = ? WHERE id = ?`).run(
    JSON.stringify(override),
    sessionId
  );
  if (launchPending(sessionId)) {
    setSessionModel(sessionId, routed);
    return { ref: routed.ref, resumed: false };
  }
  if (s.view === "chat") {
    await switchSessionModel(sessionId, routed);
    await sendChat(sessionId, {
      text: message,
      origin: { kind: "decision", label: `Resumed on ${routed.ref}` },
    });
    return { ref: routed.ref, resumed: true };
  }
  if (!s.claude_session_id || !s.worktree_path)
    throw new Error("Its terminal conversation can't be resumed");
  setSessionModel(sessionId, routed);
  await killTmux(s.tmux_name);
  await launchClaude({
    sessionId,
    tmuxName: s.tmux_name,
    cwd: s.worktree_path,
    model: routed.model,
    provider: routed.provider.id === "anthropic" ? null : routed.provider.id,
    prompt: message,
    brief: s.task_brief ?? undefined,
    resume: s.claude_session_id,
  });
  return { ref: routed.ref, resumed: true };
}
