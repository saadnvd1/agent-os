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
import { queueEvent } from "../orchestrator/events";
import { addNote } from "../orchestrator/notes";
import { amendBrief, amendmentsOf } from "../orchestrator/amendments";

export const PLAN_FILE = ".agentos/plan.md";

export function planPrompt(task: string, only = false): string {
  const after = only
    ? "it waits for approval before anything is implemented, so don't ask for it"
    : "the implementation model takes over this conversation next and follows it";
  return `${task}

---
Plan first. This turn, only read and plan: write the implementation plan for the task above to \`${PLAN_FILE}\` in this worktree (what to change, file by file; the tests; how you'll verify it; anything ambiguous and the call you'd make). Change no other file, and don't commit, push or open a PR. Don't end your turn while subagents or background commands you started are still running; wait for their results and write the plan in the same turn. End the turn once the plan is written: ${after}.`;
}

export const PLAN_RETRY_PROMPT = `Write the plan to \`${PLAN_FILE}\` now, plan only.`;
export const planRetryMessageId = (sessionId: string) =>
  `plan-retry-${sessionId}`;

// How long a planning turn may sit ended on background work before it's
// treated as having nothing running and re-prompted.
export const PLAN_BACKGROUND_WAIT_MS = 20 * 60 * 1000;

export function implementPrompt(planned: boolean, amendment?: string): string {
  const base = planned
    ? `The plan is in \`${PLAN_FILE}\`. Implement it now, finishing the task as its instructions above say. Where the plan turns out wrong, do what's right and say so.`
    : `No plan was written to \`${PLAN_FILE}\`. Plan briefly, then implement the task, finishing it as its instructions above say.`;
  return amendment
    ? `${base}\n\nThe plan was approved with this change, which is now part of the task's scope:\n${amendment}`
    : base;
}

// The worktree's plan folder, kept out of git by its own .gitignore.
export function preparePlanDir(worktree: string): void {
  const dir = path.join(worktree, path.dirname(PLAN_FILE));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n");
}

const SUMMARY_LINE = 120;

// The plan's first few headings and bullets, trimmed: what the orchestrator
// needs to know what was decided, with no model call.
export function planSummary(text: string, max = 5): string[] {
  const clean = (l: string) =>
    l
      .replace(/^\s*(?:#+|[-*+]|\d+[.)])\s+/, "")
      .replace(/[*`_]/g, "")
      .trim();
  const trim = (l: string) =>
    l.length > SUMMARY_LINE ? `${l.slice(0, SUMMARY_LINE - 1)}…` : l;
  const lines: { text: string; key: boolean }[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !raw.trim() || /^\s*(?:---+|\|)/.test(raw)) continue;
    const t = clean(raw);
    if (t)
      lines.push({ text: t, key: /^\s*(?:#+|[-*+]|\d+[.)])\s+/.test(raw) });
  }
  const keyed = lines.filter((l) => l.key);
  const picked = (keyed.length >= 3 ? keyed : lines).slice(0, max);
  return picked.map((l) => trim(l.text));
}

// Tells the orchestrator that started a task its plan is written, once.
function announcePlan(s: Session, ref: string | null, retried = false): void {
  if (!s.started_by && !s.held_by_device) return;
  const workspaceId = sessionWorkspace(s);
  // A task held for another machine's orchestrator can't reach it: the line
  // waits on the task for that orchestrator to read (orchestrator/facts).
  if (!s.held_by_device && !workspaceId) return;
  if (!s.worktree_path) return;
  const file = path.join(s.worktree_path, PLAN_FILE);
  const next = ref
    ? `implementing on ${ref}`
    : "waiting for approval, not implementing (approve_plan to go ahead, drop to reject)";
  const again = retried ? " (asked once more for it first)" : "";
  let head = `Task "${s.name}": no plan file was written${again}; ${next}${ref ? " anyway" : ""}.`;
  try {
    const summary = planSummary(fs.readFileSync(file, "utf8"));
    head = `Task "${s.name}": plan written to ${file}; ${next}.`;
    if (summary.length) head += `\n${summary.map((l) => `- ${l}`).join("\n")}`;
  } catch {
    // No plan file: the line says so.
  }
  if (s.held_by_device) {
    db.prepare(`UPDATE sessions SET plan_note = ? WHERE id = ?`).run(
      head,
      s.id
    );
    return;
  }
  queueEvent(workspaceId!, `plan-done:${s.id}`, s.id, head);
}

export const implementMessageId = (sessionId: string) =>
  `implement-${sessionId}`;

type Send = (sessionId: string, id: string) => Promise<void>;

function getSession(sessionId: string): Session | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
}

// Planning (or, once approved, awaiting) becomes implementing, once: the
// phase, the model and the message in one go, so a restart part-way finds
// either none of them or all, and sends the message on the new model. The
// message goes under a fixed id, which a restart sends rather than repeats.
async function startImplementing(
  s: Session,
  from: "planning" | "awaiting",
  send: Send,
  amendment?: string,
  retried = false
): Promise<string | null> {
  const sessionId = s.id;
  const routed = resolveRole("implement", {
    workspaceId: sessionWorkspace(s),
    override: taskOverride(s),
  });
  const id = implementMessageId(sessionId);
  const claimed = db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE sessions SET plan_phase = 'implementing'
         WHERE id = ? AND plan_phase = ? AND task_status = 'running'`
      )
      .run(sessionId, from).changes;
    if (!changed) return false;
    setSessionModel(sessionId, routed);
    enqueue(sessionId, {
      id,
      text: implementPrompt(
        fs.existsSync(path.join(s.worktree_path!, PLAN_FILE)),
        amendment
      ),
      origin: { kind: "decision", label: "Plan step" },
    });
    return true;
  })();
  if (!claimed) return null;
  if (from === "planning") {
    try {
      announcePlan(s, routed.ref, retried);
    } catch (e) {
      console.error("plan-done event failed:", e);
    }
  }
  await applySessionModel(sessionId, s.model_provider ?? ANTHROPIC, routed);
  await send(sessionId, id);
  return routed.ref;
}

// Per planning task, kept in memory: when its turn first ended on background
// work, and whether it has been asked once more for the plan. A restart
// forgets both, which costs at most one more re-prompt.
const waiting = new Map<
  string,
  { since: number; retried: boolean; timer?: ReturnType<typeof setTimeout> }
>();

export interface PlanHandoffEnv {
  // Whether the session's agent still runs subagents or background shells.
  backgroundRunning?: () => boolean;
  waitMs?: number;
  now?: () => number;
}

function stateOf(sessionId: string) {
  let w = waiting.get(sessionId);
  if (!w) waiting.set(sessionId, (w = { since: 0, retried: false }));
  return w;
}

function forget(sessionId: string): void {
  clearTimeout(waiting.get(sessionId)?.timer);
  waiting.delete(sessionId);
}

// Called when a chat goes idle. A task whose plan turn has ended (it has a
// recorded plan turn) moves to implementing, once; a plan-only task instead
// waits for approval (approvePlan), holding no agent process. A turn that
// ended with no plan file isn't the end of planning while its background
// work runs (the agent resumes with the results): it waits, up to a limit,
// then asks once for the plan before falling back to today's behaviour.
export async function handoffAfterPlan(
  sessionId: string,
  send: Send,
  env: PlanHandoffEnv = {}
): Promise<boolean> {
  const planned = db
    .prepare(
      `SELECT 1 FROM chat_turns WHERE session_id = ? AND role = 'plan' LIMIT 1`
    )
    .get(sessionId);
  if (!planned) return false;
  const s = getSession(sessionId);
  if (s?.plan_phase !== "planning" || !s.worktree_path) return false;
  if (!fs.existsSync(path.join(s.worktree_path, PLAN_FILE))) {
    const w = stateOf(sessionId);
    const now = (env.now ?? Date.now)();
    const limit = env.waitMs ?? PLAN_BACKGROUND_WAIT_MS;
    if (env.backgroundRunning?.()) {
      if (!w.since) w.since = now;
      if (now - w.since < limit) {
        clearTimeout(w.timer);
        // No further turn may come to re-check this; the timer does.
        w.timer = setTimeout(
          () =>
            void handoffAfterPlan(sessionId, send, env).catch((e) =>
              console.error(`Plan handoff for ${sessionId} failed:`, e)
            ),
          Math.max(limit - (now - w.since), 1) + 1
        );
        w.timer.unref?.();
        return false;
      }
    }
    if (!w.retried) {
      w.retried = true;
      w.since = 0;
      clearTimeout(w.timer);
      const id = planRetryMessageId(sessionId);
      enqueue(sessionId, {
        id,
        text: PLAN_RETRY_PROMPT,
        origin: { kind: "decision", label: "Plan step" },
      });
      await send(sessionId, id);
      return false;
    }
  }
  const retried = waiting.get(sessionId)?.retried ?? false;
  forget(sessionId);
  if (!s.plan_only)
    return (
      (await startImplementing(s, "planning", send, undefined, retried)) !==
      null
    );
  const awaiting = db
    .prepare(
      `UPDATE sessions SET plan_phase = 'awaiting'
       WHERE id = ? AND plan_phase = 'planning' AND task_status = 'running'`
    )
    .run(sessionId).changes;
  if (!awaiting) return false;
  try {
    announcePlan(s, null, retried);
  } catch (e) {
    console.error("plan-done event failed:", e);
  }
  // The worker has nothing left to do: it ends at this turn boundary, and
  // the next message (an approval, or a revision) starts one that resumes.
  try {
    await (await import("../chat/runner")).retireChat(sessionId);
  } catch (e) {
    console.error(`Releasing the worker of ${sessionId} failed:`, e);
  }
  return true;
}

// approvePlan, sending through the chat runner (imported when needed: it
// imports this file).
export async function approvePlanNow(sessionId: string, message?: string) {
  const { sendQueuedNow } = await import("../chat/runner");
  return approvePlan(sessionId, message, (id, m) => sendQueuedNow(id, m));
}

// Approves a waiting plan-only task: implementation starts on the
// implementation model, once. A message amends the plan and is recorded on
// the task's brief as a scope change, before implementing, so its review
// judges against it.
export async function approvePlan(
  sessionId: string,
  message: string | undefined,
  send: Send
): Promise<{ ref: string; amendments: number }> {
  const s = getSession(sessionId);
  if (!s || s.plan_phase !== "awaiting" || s.task_status !== "running")
    throw new Error(
      `${s?.name ?? "That task"} isn't waiting for plan approval`
    );
  const text = message?.trim() || undefined;
  const workspaceId = sessionWorkspace(s);
  if (text && workspaceId) {
    amendBrief(workspaceId, s.id, text);
    addNote(workspaceId, `Plan approved with a change for ${s.name}: ${text}`);
  }
  const ref = await startImplementing(s, "awaiting", send, text);
  if (!ref) throw new Error(`${s.name} isn't waiting for plan approval`);
  return { ref, amendments: amendmentsOf(s.id).length };
}
