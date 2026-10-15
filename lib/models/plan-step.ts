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
import { deleteQueued, enqueue } from "../chat/queued";
import { applySessionModel } from "./session-model";
import {
  resolveRole,
  sessionWorkspace,
  setSessionModel,
  taskOverride,
} from "./resolve";
import { ANTHROPIC } from "./roles";
import { queueEvent } from "../orchestrator/events";
import { noApprovalsOn, recordAutoApproval } from "../approvals/no-approvals";
import { addNote } from "../orchestrator/notes";
import { amendBrief, scopeChangesOf } from "../orchestrator/amendments";
import { PIECES_PROMPT, foldedBrief, pieceBrief } from "../plans/pieces";
import { orchestratorOf } from "../tasks/starter";
import { isRemoteHost } from "../hosts";
import { refreshBase } from "../tasks/refresh-base";
import {
  createFeature,
  ownPieceOf,
  planFor,
  planPathOf,
  splitOf,
} from "../plans/features";

export const PLAN_FILE = ".agentos/plan.md";

export function planPrompt(task: string, only = false): string {
  const after = only
    ? "it waits for approval before anything is implemented, so don't ask for it"
    : "the implementation model takes over this conversation next and follows it";
  return `${task}

---
Plan first. This turn, only read and plan: write the implementation plan for the task above to \`${PLAN_FILE}\` in this worktree (what to change, file by file; the tests; how you'll verify it; anything ambiguous and the call you'd make). Change no other file, and don't commit, push or open a PR. Don't end your turn while subagents or background commands you started are still running; wait for their results and write the plan in the same turn. End the turn once the plan is written: ${after}.

${PIECES_PROMPT}`;
}

export const PLAN_RETRY_PROMPT = `Write the plan to \`${PLAN_FILE}\` now, plan only.`;
export const planRetryMessageId = (sessionId: string) =>
  `plan-retry-${sessionId}`;

// How long a planning turn may sit ended on background work before it's
// treated as having nothing running and re-prompted.
export const PLAN_BACKGROUND_WAIT_MS = 20 * 60 * 1000;

export function implementPrompt(
  planned: boolean,
  amendment?: string,
  piece?: string,
  baseNote?: string
): string {
  const where = ` Work only in this task's repository; if part of the work belongs in another repository, say so in your final message instead of doing it there.`;
  const base = piece
    ? `The plan is in \`${PLAN_FILE}\`. ${piece}\nFinish it as the task's instructions above say. Where the plan turns out wrong, do what's right and say so.${where}`
    : planned
      ? `The plan is in \`${PLAN_FILE}\`. Implement it now, finishing the task as its instructions above say. Where the plan turns out wrong, do what's right and say so.${where}`
      : `No plan was written to \`${PLAN_FILE}\`. Plan briefly, then implement the task, finishing it as its instructions above say.`;
  const full = amendment
    ? `${base}\n\nThe plan was approved with this change, which is now part of the task's scope:\n${amendment}`
    : base;
  return baseNote ? `${full}\n\n${baseNote}` : full;
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

function piecesLine(r: NonNullable<ReturnType<typeof planFor>>): string {
  const parts = r.pieces.map((p) => {
    const after = p.afterPosition
      ? ` after ${p.afterPosition} is ${p.afterKind}`
      : "";
    const why = p.reasons.length ? ` (${p.reasons.join("+")})` : "";
    return `${p.position} ${p.name} [${p.project.name}]${after}${why}`;
  });
  const folded = r.folded.length ? `, ${r.folded.length} folded` : "";
  return `${r.pieces.length} pieces${folded}: ${parts.join("; ")}`;
}

// The "plan written" line for a task: where the plan is, what comes next,
// its first lines and how it split. `file` is where this machine can read it.
export function planNoteFor(
  s: Session,
  file: string,
  next: string,
  again = "",
  after = ""
): string {
  let head = `Task "${s.name}": no plan file was written${again}; ${next}${after}.`;
  try {
    const text = fs.readFileSync(file, "utf8");
    const summary = planSummary(text);
    head = `Task "${s.name}": plan written to ${file}; ${next}.`;
    if (summary.length) head += `\n${summary.map((l) => `- ${l}`).join("\n")}`;
    const pieces = planFor(s, text);
    if (pieces && pieces.pieces.length > 1) head += `\n${piecesLine(pieces)}`;
    if (pieces?.folded.length)
      head += `\nPlan listed ${pieces.listed} pieces, building ${pieces.pieces.length}: ${pieces.folded.map((f) => `${f.name} folded (${f.why})`).join("; ")}`;
  } catch {
    // No plan file: the line says so.
  }
  return head;
}

// Tells the orchestrator that started a task its plan is written, once.
function announcePlan(s: Session, ref: string | null, retried = false): void {
  // The machine that placed it announces the plan, from its own copy.
  if (s.plan_waits_for_caller) return;
  if (!orchestratorOf(s.started_by) && !s.held_by_device) return;
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
  const head = planNoteFor(s, file, next, again, ref ? " anyway" : "");
  if (s.held_by_device) {
    db.prepare(`UPDATE sessions SET plan_note = ? WHERE id = ?`).run(
      head,
      s.id
    );
    return;
  }
  queueEvent(workspaceId!, `plan-done:${s.id}`, s.id, head);
}

// Plans that build as other than one piece in this repository say so, once.
function sayHowItSplit(
  s: Session,
  workspaceId: string,
  split: NonNullable<ReturnType<typeof splitOf>>,
  nothingOwn: boolean
): void {
  if (nothingOwn)
    queueEvent(
      workspaceId,
      `plan-routed:${s.id}`,
      s.id,
      `Task "${s.name}" split its plan into ${split.pieces.length} ${split.pieces.length === 1 ? "piece" : "pieces"} and none is first in its own repository, so it builds nothing itself and ends; each piece starts as its own task: ${split.pieces.map((p) => `${p.position} ${p.name} [${p.project.name}]`).join("; ")}.`
    );
  else if (split.folded.length)
    queueEvent(
      workspaceId,
      `plan-folded:${s.id}`,
      s.id,
      `Plan of "${s.name}" listed ${split.listed} pieces, building ${split.pieces.length}: ${split.folded.map((f) => `${f.name} folded into ${f.into} (${f.why})`).join("; ")}. The task was told to build the folded work too.`
    );
}

// A planning task with no piece of its own is finished: its pieces are
// started as tasks in their projects, now rather than on the next sweep.
async function handOffToPieces(s: Session): Promise<void> {
  try {
    const { doneSession } = await import("../done");
    await doneSession(s.id, { by: "direct", noMerge: true });
  } catch (e) {
    console.error(`Ending planning task ${s.id} failed:`, e);
  }
  try {
    const { releasePieces } = await import("../plans/release");
    await releasePieces();
  } catch (e) {
    console.error("Starting the pieces failed:", e);
  }
}

function readPlan(s: Session): string | null {
  try {
    return fs.readFileSync(path.join(s.worktree_path!, PLAN_FILE), "utf8");
  } catch {
    return null;
  }
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
  const planText = readPlan(s);
  // The branch was cut when the task was created; the plan may have waited.
  const fresh = await refreshBase({
    name: s.name,
    worktree: s.worktree_path,
    branch: s.branch_name,
    base: s.base_branch,
  });
  const baseNote = fresh.moved
    ? undefined
    : fresh.note &&
      `Note: ${fresh.note}. Rebase onto the latest base before you open the PR.`;
  // A plan another machine placed here was checked there, against its
  // projects; this one's workspace doesn't know them.
  let split =
    planText && !s.plan_waits_for_caller ? splitOf(s, planText) : null;
  const workspaceId = sessionWorkspace(s);
  // Approved despite pieces that couldn't be registered: built as one piece,
  // and told so, rather than guessing which repository each belongs to.
  const unreadable = split?.errors.length ? split.errors : null;
  if (unreadable) split = null;
  let nothingOwn = false;
  let featureId: string | null = null;
  const claimed = db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE sessions SET plan_phase = 'implementing'
         WHERE id = ? AND plan_phase = ? AND task_status = 'running'`
      )
      .run(sessionId, from).changes;
    if (!changed) return false;
    setSessionModel(sessionId, routed);
    let piece: string | undefined;
    let note = amendment;
    if (unreadable)
      note = [
        amendment,
        `The plan's pieces couldn't be registered (${unreadable.join("; ")}); build the whole plan as one piece in this repository.`,
      ]
        .filter(Boolean)
        .join("\n");
    if (split?.notBuilding.length)
      note = [amendment, `Not building: ${split.notBuilding.join("; ")}`]
        .filter(Boolean)
        .join("\n");
    if (split?.feature && planText && workspaceId) {
      const feature = createFeature(s, planText, split.pieces, workspaceId, {
        listed: split.listed,
        folded: split.folded,
      });
      featureId = feature.id;
      const own = ownPieceOf(split.pieces, s.project_id);
      if (!own) nothingOwn = true;
      else if (split.pieces.length === 1 && split.folded.length)
        piece = foldedBrief(split);
      else
        piece = pieceBrief(
          split.pieces.length,
          own,
          planPathOf(feature.id),
          [],
          own.project.name
        );
    }
    // Every piece is another task's: nothing for this one to implement.
    if (nothingOwn) return true;
    enqueue(sessionId, {
      id,
      text: implementPrompt(
        fs.existsSync(path.join(s.worktree_path!, PLAN_FILE)),
        note,
        piece,
        baseNote
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
  if (split?.feature && featureId && workspaceId)
    sayHowItSplit(s, workspaceId, split, nothingOwn);
  if (nothingOwn) {
    await handOffToPieces(s);
    return routed.ref;
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
  // Whether the chat is in the middle of a turn right now.
  turnRunning?: () => boolean;
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

// A task dropped, stopped or done: nothing left to wait for.
export const forgetPlanWait = forget;

// A new turn began (the agent resumed with its background results): whatever
// the wait was counting is stale, and the deadline restarts at the next idle.
export function planTurnStarted(sessionId: string): void {
  const w = waiting.get(sessionId);
  if (!w) return;
  clearTimeout(w.timer);
  w.timer = undefined;
  w.since = 0;
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
  if (s?.plan_phase !== "planning" || !s.worktree_path) {
    forget(sessionId);
    return false;
  }
  if (s.task_status !== "running" || s.archived_at) {
    forget(sessionId);
    return false;
  }
  // Mid-turn, the turn's own end decides.
  if (env.turnRunning?.()) return false;
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
      try {
        await send(sessionId, id);
      } catch (e) {
        // Not left queued behind a turn that may write the plan itself.
        deleteQueued(sessionId, id);
        throw e;
      }
      return false;
    }
  }
  // A re-prompt still queued is stale now.
  deleteQueued(sessionId, planRetryMessageId(sessionId));
  const retried = waiting.get(sessionId)?.retried ?? false;
  forget(sessionId);
  // No approvals mode doesn't stop at the plan to wait for one. Pieces that
  // couldn't be registered always do: building on a guess is the bug.
  const auto = !!s.plan_only && noApprovalsOn() && !s.plan_waits_for_caller;
  const planText = readPlan(s);
  const pieceErrors =
    (planText && !s.plan_waits_for_caller
      ? splitOf(s, planText)?.errors
      : null) ?? [];
  if ((!s.plan_only || auto) && !pieceErrors.length) {
    const ref = await startImplementing(
      s,
      "planning",
      send,
      undefined,
      retried
    );
    if (ref && auto)
      recordAutoApproval({
        source: "plan",
        workspaceId: sessionWorkspace(s),
        sessionId,
        subject: `plan for ${s.name}`,
        detail: "implementing without waiting for approve_plan",
      });
    return ref !== null;
  }
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
  const workspaceId = sessionWorkspace(s);
  if (pieceErrors.length && workspaceId)
    queueEvent(
      workspaceId,
      `plan-pieces:${s.id}`,
      s.id,
      `Plan of "${s.name}": couldn't register its pieces: ${pieceErrors.join("; ")}. It is held, not building. Message the task to fix the plan, or approve_plan to build it as one piece.`
    );
  // The machine that placed a plan sends its own push.
  try {
    if (!s.plan_waits_for_caller) {
      const text = readPlan(s);
      const planned = text ? planFor(s, text) : null;
      (await import("../notify/push/events")).pushPlanAwaiting(
        s.id,
        s.name,
        planned?.pieces.length ?? 1
      );
    }
  } catch (e) {
    console.error("plan push failed:", e);
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

// On server start: tasks still planning get the same check an idle chat
// does, since the idle that would have run it may have come and gone while
// the server was down. `envFor` reads the live chat's state.
export async function recheckPlanning(
  send: Send,
  envFor: (sessionId: string) => PlanHandoffEnv
): Promise<void> {
  const rows = db
    .prepare(
      `SELECT id FROM sessions
       WHERE plan_phase = 'planning' AND task_status = 'running'
         AND archived_at IS NULL AND worktree_path IS NOT NULL`
    )
    .all() as { id: string }[];
  for (const { id } of rows)
    await handoffAfterPlan(id, send, envFor(id)).catch((e) =>
      console.error(`Plan re-check for ${id} failed:`, e)
    );
}

export type ApprovedBy = "saad" | "orchestrator" | "no-approvals";

const APPROVAL_TEXT: Record<ApprovedBy, string> = {
  saad: "Saad approved the plan; implement it as planned.",
  orchestrator: "The orchestrator approved the plan; implement it as planned.",
  "no-approvals":
    "The plan was approved automatically (no-approvals mode); implement it as planned.",
};

// approvePlan, sending through the chat runner (imported when needed: it
// imports this file).
export async function approvePlanNow(
  sessionId: string,
  message?: string,
  by: ApprovedBy = "saad"
) {
  const { sendQueuedNow } = await import("../chat/runner");
  return approvePlan(sessionId, message, (id, m) => sendQueuedNow(id, m), by);
}

// Approves a waiting plan-only task: implementation starts on the
// implementation model, once. A message amends the plan and is recorded on
// the task's brief as a scope change, before implementing, so its review
// judges against it.
export async function approvePlan(
  sessionId: string,
  message: string | undefined,
  send: Send,
  by: ApprovedBy = "saad"
): Promise<{ ref: string; amendments: number }> {
  const s = getSession(sessionId);
  if (!s || s.plan_phase !== "awaiting" || s.task_status !== "running")
    throw new Error(
      `${s?.name ?? "That task"} isn't waiting for plan approval`
    );
  const text = message?.trim() || undefined;
  const workspaceId = sessionWorkspace(s);
  // A plan another machine placed here is approved by that machine, which
  // keeps the brief its review reads.
  const placedHere = !!s.plan_waits_for_caller && !isRemoteHost(s.host_id);
  // Every approval is on the brief, so the review judges the PR as the
  // implementation of the plan, not as plan-only work.
  if (workspaceId && !placedHere) {
    if (text) {
      amendBrief(workspaceId, s.id, text);
      addNote(
        workspaceId,
        `Plan approved with a change for ${s.name}: ${text}`
      );
    } else amendBrief(workspaceId, s.id, APPROVAL_TEXT[by], "approval");
  }
  // On another machine, the plan was written there: this machine decides
  // where it is built, and the approval follows it.
  const ref = isRemoteHost(s.host_id)
    ? await (await import("../tasks/remote-plan")).continueRemotePlan(s, text)
    : await startImplementing(s, "awaiting", send, text);
  if (!ref) throw new Error(`${s.name} isn't waiting for plan approval`);
  if (by === "no-approvals")
    recordAutoApproval({
      source: "plan",
      workspaceId,
      sessionId,
      subject: `plan for ${s.name}`,
      detail: "already waiting when the mode was turned on",
    });
  return { ref, amendments: scopeChangesOf(s.id).length };
}

// A plan that moved here to be built (remote-plan.ts): implementation starts
// on this machine, once, with the approval's change if it had one.
export async function implementArrived(
  sessionId: string,
  message?: string
): Promise<string | null> {
  const s = getSession(sessionId);
  if (!s || s.plan_phase !== "awaiting" || s.task_status !== "running")
    throw new Error(`${s?.name ?? "That task"} isn't waiting for a plan`);
  const { sendQueuedNow } = await import("../chat/runner");
  return startImplementing(
    s,
    "awaiting",
    (id, m) => sendQueuedNow(id, m),
    message
  );
}
