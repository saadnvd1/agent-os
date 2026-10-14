/**
 * Timed pause of a running session, with auto-resume.
 *
 * running -> pausing -> paused -> resuming -> running. The agent's process is
 * ended, never frozen: by default at the end of its current turn, or at once
 * for "pause now". The worktree, the branch and the conversation stay. While
 * pausing and paused its chat is held (lib/chat/hold.ts), so whatever would
 * wake it waits in the queue and arrives, with the continue prompt, in one
 * turn when it resumes. A paused task gives its slot back; a resume that came
 * due competes for a slot as a scored candidate (lib/tasks/queue.ts).
 *
 * Everything is in SQLite (task_pauses and the session's pause columns), and
 * the sweep re-drives each state after a restart.
 */

import { db, type Session, type TaskPause } from "../db";
import { toSqliteTime } from "../session-meta";
import { endPause, endPauseOnFinish, formatUntil } from "./pause-hold";
import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { chatState, chatStateNow, releaseChat, stopChat } from "../chat/runner";
import { stopChatAtTurnEnd, stopChatTurn } from "../chat/stop";
import { waitForExit } from "../chat/worker/client";
import { isHeld } from "../chat/hold";
import { settingUp } from "../sessions/setup-progress";
import { statusDetector } from "../status-detector";
import { launchPending } from "./launch-gate";
import { killTmux } from "./start";
import { launchClaude } from "../agents/launch";
import { resolveRole, sessionWorkspace, taskOverride } from "../models/resolve";
import { sessionRole } from "../models/session-role";
import { holdingEscalations } from "../orchestrator/gates";
import { openBySubject, workSubject } from "../orchestrator/asks";
import { queueEventOnce } from "../orchestrator/events";
import { isPaused } from "../orchestrator/pause";
import { isMerging } from "./finish";
import { autoHold } from "./auto-hold";
import { localView } from "../load/machines";
import { machineHold } from "./schedule";
import {
  continuePrompt,
  durationText,
  pauseRefusal,
  resumeRefusal,
  type HeldMessage,
  type PauseFacts,
} from "./pause-policy";
import {
  DEFAULT_PRIORITY,
  isPriority,
  type PauseBy,
  type PauseView,
  type Priority,
} from "./schedule-types";

export class PauseRefused extends Error {}

// A pausing session whose turn hasn't ended after this is let go again.
export const PAUSE_WAIT_MS = 2 * 60 * 60_000;
// "Pause now" waits this long for a push, merge or rebase already under way.
const CRITICAL_WAIT_MS = 5 * 60_000;
const SWEEP_MS = 15_000;
const MAX_PAUSE_MS = 60 * 24 * 3600_000;
const CRITICAL =
  /\bgit\s+(push|rebase|commit|merge)\b|\bgh\s+pr\s+(create|merge)\b/;

const g = globalThis as unknown as {
  __agentosPauseDriving?: Map<number, symbol>;
  __agentosPauseTimer?: ReturnType<typeof setInterval>;
};
const driving = (g.__agentosPauseDriving ??= new Map<number, symbol>());

const nudge = () =>
  void import("./queue").then((q) => q.tickQueueSoon()).catch(() => undefined);

const sessionOf = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

const pauseRow = (id: number) =>
  db.prepare(`SELECT * FROM task_pauses WHERE id = ?`).get(id) as
    | TaskPause
    | undefined;

// SQLite's datetime('now') is UTC without a zone.
const ms = (v: string | null | undefined) =>
  v ? Date.parse(v.includes("T") ? v : `${v.replace(" ", "T")}Z`) || 0 : 0;

export const activePause = (sessionId: string): TaskPause | null =>
  (db
    .prepare(
      `SELECT * FROM task_pauses WHERE session_id = ? AND state != 'ended'
       ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId) as TaskPause | undefined) ?? null;

function factsOf(s: Session): PauseFacts {
  const project = s.project_id ? getProject(s.project_id) : null;
  const workspaceId = project?.workspace_id ?? s.workspace_id ?? null;
  const question = db
    .prepare(
      `SELECT 1 FROM orchestrator_questions WHERE status = 'open' AND task = ?`
    )
    .get(s.id);
  return {
    isTask: !!s.task_status,
    isOrchestrator: s.role === "orchestrator",
    isQuickChange: !!s.quick_of,
    isRemote: isRemoteHost(s.host_id) || !!s.peer_mirror,
    taskStatus: s.task_status ?? null,
    pauseState: s.pause_state ?? null,
    held: isHeld(s.id),
    merging: isMerging(s.id),
    settingUp: settingUp(s.id) || launchPending(s.id),
    chatWaiting: s.view === "chat" && chatState(s.id) === "waiting",
    terminalWaiting: s.view !== "chat" && s.status === "waiting",
    openAsk: !!workspaceId && !!openBySubject(workspaceId, workSubject(s.id)),
    openQuestion: !!question,
    escalated: holdingEscalations(s.id).length > 0,
    planAwaiting: s.plan_phase === "awaiting",
    resumable:
      s.view === "chat" ||
      (s.agent_type === "claude" && !!s.claude_session_id && !!s.worktree_path),
  };
}

export function pauseRefusalFor(sessionId: string): string | null {
  const s = sessionOf(sessionId);
  if (!s || s.archived_at) return "No such session";
  return pauseRefusal(factsOf(s));
}

function say(s: Session, key: string, line: string): void {
  const workspaceId =
    (s.project_id && getProject(s.project_id)?.workspace_id) || null;
  if (workspaceId && s.task_status)
    queueEventOnce(workspaceId, key, s.id, line);
}

export interface PauseRequest {
  // When it resumes by itself; null: until resumed.
  until: Date | null;
  mode?: "turn" | "now";
  by?: PauseBy;
  byId?: string | null;
  reason?: string | null;
}

// Starts a pause. Throws PauseRefused with the reason it can't.
export function requestPause(sessionId: string, req: PauseRequest): TaskPause {
  const s = sessionOf(sessionId);
  if (!s || s.archived_at) throw new PauseRefused("No such session");
  const mode = req.mode ?? "turn";
  const until = req.until;
  if (until && until.getTime() - Date.now() > MAX_PAUSE_MS)
    throw new PauseRefused("A pause can be at most 60 days");
  if (until && until.getTime() <= Date.now())
    throw new PauseRefused("That time has passed");
  const existing = activePause(sessionId);
  if (existing?.state === "pausing") {
    // Already on its way: "pause now" speeds it up, a new time replaces the old.
    db.prepare(
      `UPDATE task_pauses SET mode = ?, until_at = ? WHERE id = ?`
    ).run(
      mode === "now" ? "now" : existing.mode,
      until ? toSqliteTime(until) : null,
      existing.id
    );
    db.prepare(`UPDATE sessions SET paused_until = ? WHERE id = ?`).run(
      until ? toSqliteTime(until) : null,
      sessionId
    );
    // "Pause now" takes over: the first driver is superseded, not raced.
    drive(sessionId, existing.id, mode === "now");
    return pauseRow(existing.id)!;
  }
  const refusal = pauseRefusal(factsOf(s));
  if (refusal) throw new PauseRefused(refusal);
  const id = Number(
    db
      .prepare(
        `INSERT INTO task_pauses (session_id, mode, by_kind, by_id, reason, until_at, state)
         VALUES (?, ?, ?, ?, ?, ?, 'pausing')`
      )
      .run(
        sessionId,
        mode,
        req.by ?? "person",
        req.byId ?? null,
        req.reason?.slice(0, 300) ?? null,
        until ? toSqliteTime(until) : null
      ).lastInsertRowid
  );
  db.prepare(
    `UPDATE sessions SET pause_state = 'pausing', paused_until = ?, pause_id = ? WHERE id = ?`
  ).run(until ? toSqliteTime(until) : null, id, sessionId);
  drive(sessionId, id);
  return pauseRow(id)!;
}

// A running critical command (a push, merge, rebase or commit) in a chat.
function criticalInFlight(sessionId: string): boolean {
  const rows = db
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ? AND kind = 'tool'
       ORDER BY seq DESC LIMIT 5`
    )
    .all(sessionId) as { data: string }[];
  return rows.some((r) => {
    let item: {
      name?: string;
      status?: string;
      input?: { command?: unknown };
    };
    try {
      item = JSON.parse(r.data);
    } catch {
      return false;
    }
    return (
      item.status === "running" &&
      item.name === "Bash" &&
      typeof item.input?.command === "string" &&
      CRITICAL.test(item.input.command)
    );
  });
}

const sleep = (n: number) => new Promise<void>((r) => setTimeout(r, n));

function stillPausing(pauseId: number): boolean {
  return pauseRow(pauseId)?.state === "pausing";
}

// Ends the agent at the turn boundary (or now), then marks it paused. Each
// driver holds a token; a newer one (pause now) replaces it, and the old one
// then does nothing with its outcome.
function drive(sessionId: string, pauseId: number, takeOver = false): void {
  if (driving.has(pauseId) && !takeOver) return;
  const token = Symbol(String(pauseId));
  driving.set(pauseId, token);
  const mine = () => driving.get(pauseId) === token;
  void (async () => {
    try {
      const outcome = await stopAgent(sessionId, pauseId, mine);
      if (!mine() || !stillPausing(pauseId)) return;
      if (outcome !== true) return void cancelPause(sessionId, outcome);
      markPaused(sessionId, pauseId);
    } catch (error) {
      console.error("[pause] stop:", error);
    } finally {
      if (mine()) driving.delete(pauseId);
    }
  })();
}

// True when the agent is stopped; otherwise why it couldn't be.
async function stopAgent(
  sessionId: string,
  pauseId: number,
  mine: () => boolean
): Promise<true | string> {
  const s = sessionOf(sessionId);
  if (!s) return "No such session";
  if (s.view === "chat") {
    const row = pauseRow(pauseId)!;
    if (row.mode === "now") {
      for (let waited = 0; criticalInFlight(sessionId); waited += 1000) {
        if (!mine() || !stillPausing(pauseId)) return true;
        if (waited >= CRITICAL_WAIT_MS)
          return "a push or merge was still running; try again once it ends";
        await sleep(1000);
      }
      const interrupted = chatState(sessionId) === "running";
      const stop = await stopChatTurn(sessionId);
      if (!stop.stopped) return stop.reason;
      if (interrupted)
        db.prepare(`UPDATE task_pauses SET interrupted = 1 WHERE id = ?`).run(
          pauseId
        );
      stopChat(sessionId);
      await waitForExit(sessionId);
      return true;
    }
    const stop = await stopChatAtTurnEnd(sessionId, { waitMs: PAUSE_WAIT_MS });
    return stop.stopped ? true : stop.reason;
  }
  // A terminal: at the boundary, when its status reads idle.
  for (let waited = 0; ; waited += 2000) {
    if (!mine() || !stillPausing(pauseId)) return true;
    const now = sessionOf(sessionId);
    if (!now) return "No such session";
    if (now.status === "waiting") return "it's waiting on you";
    if (now.status !== "running") break;
    if (waited >= PAUSE_WAIT_MS)
      return "its agent's turn was still running after two hours";
    await sleep(2000);
  }
  await killTmux(s.tmux_name);
  return true;
}

function markPaused(sessionId: string, pauseId: number): void {
  const changed = db.transaction(() => {
    const n = db
      .prepare(
        `UPDATE task_pauses SET state = 'paused', paused_at = datetime('now')
         WHERE id = ? AND state = 'pausing'`
      )
      .run(pauseId).changes;
    if (n)
      db.prepare(`UPDATE sessions SET pause_state = 'paused' WHERE id = ?`).run(
        sessionId
      );
    return n;
  })();
  if (!changed) return;
  const s = sessionOf(sessionId);
  const row = pauseRow(pauseId);
  if (s && row)
    say(
      s,
      `paused:${pauseId}`,
      `Task "${s.name}" was paused ${row.until_at ? `until ${formatUntil(row.until_at)}` : "until resumed"}${row.reason ? ` (${row.reason})` : ""}. Its slot is free.`
    );
  nudge();
}

// A pausing session goes back to running (the person said so, or the turn
// couldn't be ended). What was held is let through.
export function cancelPause(
  sessionId: string,
  why: string | null = null
): void {
  const row = activePause(sessionId);
  if (!row || row.state !== "pausing") return;
  endPause(row, "cancelled");
  void releaseChat(sessionId).catch(() => undefined);
  const s = sessionOf(sessionId);
  if (s && why)
    say(
      s,
      `pause-cancelled:${row.id}`,
      `Pausing "${s.name}" was stopped: ${why}.`
    );
}

export { endPauseOnFinish };

// Changes when a paused (or pausing) session resumes by itself.
export function setResumeTime(sessionId: string, until: Date | null): void {
  const row = activePause(sessionId);
  if (!row) throw new PauseRefused("It isn't paused");
  if (until && until.getTime() <= Date.now())
    throw new PauseRefused("That time has passed");
  if (until && until.getTime() - Date.now() > MAX_PAUSE_MS)
    throw new PauseRefused("A pause can be at most 60 days");
  const value = until ? toSqliteTime(until) : null;
  db.transaction(() => {
    db.prepare(
      `UPDATE task_pauses SET until_at = ?, resume_requested_at = NULL WHERE id = ? AND state IN ('pausing','paused')`
    ).run(value, row.id);
    db.prepare(`UPDATE sessions SET paused_until = ? WHERE id = ?`).run(
      value,
      sessionId
    );
  })();
}

// Why this actor may not lift the pause, or null.
export function resumeBlock(sessionId: string, actor: PauseBy): string | null {
  const row = activePause(sessionId);
  if (!row) return "It isn't paused";
  return resumeRefusal(actor, row.by_kind, row.until_at);
}

// Marks a paused session's resume as due: a task then competes for a slot
// (queue tick), anything else resumes at once. Only the timer uses this for
// a task; a person or the orchestrator resuming goes through resumeNow.
export function requestResume(sessionId: string, actor: PauseBy): void {
  const refusal = resumeBlock(sessionId, actor);
  if (refusal) throw new PauseRefused(refusal);
  const row = activePause(sessionId)!;
  if (row.state === "pausing") return cancelPause(sessionId);
  if (row.state !== "paused") return;
  db.prepare(
    `UPDATE task_pauses SET resume_requested_at = COALESCE(resume_requested_at, datetime('now')), resume_by_kind = ? WHERE id = ?`
  ).run(actor, row.id);
  const s = sessionOf(sessionId);
  if (s?.task_status) nudge();
  else
    void claimResume(sessionId, { reason: actor }).catch((error) =>
      console.error("[pause] resume:", error)
    );
}

// Why this machine's load rules out starting an agent now, or null. Only a
// red (or still settling) machine holds a resume; amber doesn't.
export function loadHoldFor(s: Session): string | null {
  const project = s.project_id ? getProject(s.project_id) : null;
  if (!project || isRemoteHost(s.host_id ?? project.host_id)) return null;
  const hold = machineHold(
    {
      heavy: false,
      needsUnmet: false,
      remote: false,
      priority: DEFAULT_PRIORITY,
    },
    localView(),
    Date.now()
  );
  return hold?.code === "load_red" ? hold.text.replace(/^Waiting: /, "") : null;
}

// Why a resume this actor asked for must wait: this machine's load, and for
// the orchestrator also what holds its own starts (it is paused, or the
// usage window). Saad's own resume skips the second.
export function resumeHoldFor(s: Session, actor: PauseBy): string | null {
  const load = loadHoldFor(s);
  if (load) return load;
  if (actor !== "orchestrator") return null;
  const ws = s.project_id ? getProject(s.project_id)?.workspace_id : null;
  return autoHold(ws ?? null)?.text.replace(/^Waiting: /, "") ?? null;
}

export function setPauseNote(sessionId: string, note: string | null): void {
  db.prepare(
    `UPDATE sessions SET pause_note = ? WHERE id = ? AND pause_state = 'paused' AND COALESCE(pause_note, '') != COALESCE(?, '')`
  ).run(note, sessionId, note);
}

export type ResumeOutcome =
  | { outcome: "resumed" | "cancelled" }
  | { outcome: "held"; note: string };

// A deliberate Resume, by a person or the orchestrator: starts at once, past
// the slot limit, like Start now. A machine in the red still holds it: it is
// recorded as asked for, says why on the task, and goes when the load
// calms.
export async function resumeNow(
  sessionId: string,
  actor: PauseBy = "person"
): Promise<ResumeOutcome> {
  const refusal = resumeBlock(sessionId, actor);
  if (refusal) throw new PauseRefused(refusal);
  const row = activePause(sessionId)!;
  if (row.state === "pausing") {
    cancelPause(sessionId);
    return { outcome: "cancelled" };
  }
  const s = sessionOf(sessionId);
  const why = s ? resumeHoldFor(s, actor) : null;
  if (s && why && row.state === "paused") {
    db.prepare(
      `UPDATE task_pauses SET resume_requested_at = COALESCE(resume_requested_at, datetime('now')), resume_by_kind = ? WHERE id = ?`
    ).run(actor, row.id);
    const note = `held: ${why}`;
    setPauseNote(sessionId, note);
    nudge();
    return { outcome: "held", note };
  }
  await claimResume(sessionId, { reason: actor, force: true });
  return { outcome: "resumed" };
}

export interface DueResume {
  sessionId: string;
  pauseId: number;
  projectId: string;
  priority: Priority;
  dueAtMs: number;
  byKind: PauseBy;
  // A person or the orchestrator asked: it isn't queued behind the slot limit.
  resumeBy: PauseBy | null;
}

// Paused tasks whose time came (or that someone asked to resume), for the
// queue to score against new arrivals. Their age counts from when due.
export function dueResumes(): DueResume[] {
  const rows = db
    .prepare(
      `SELECT p.id AS pause_id, p.session_id, p.by_kind, p.until_at, p.resume_requested_at, p.resume_by_kind,
              s.project_id, s.priority
       FROM task_pauses p JOIN sessions s ON s.id = p.session_id
       WHERE p.state = 'paused' AND p.resume_requested_at IS NOT NULL
         AND s.task_status IN ('running') AND s.archived_at IS NULL`
    )
    .all() as {
    pause_id: number;
    session_id: string;
    by_kind: PauseBy;
    until_at: string | null;
    resume_requested_at: string;
    resume_by_kind: string | null;
    project_id: string | null;
    priority: string | null;
  }[];
  return rows
    .filter((r) => !!r.project_id)
    .map((r) => ({
      sessionId: r.session_id,
      pauseId: r.pause_id,
      projectId: r.project_id!,
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      dueAtMs: r.until_at ? ms(r.until_at) : ms(r.resume_requested_at),
      byKind: r.by_kind,
      resumeBy: (r.resume_by_kind as PauseBy | null) ?? null,
    }));
}

const SENT = /"from":"([^"]*)"/;

// The messages held for a chat while it was paused, as one prompt's lines.
// Messages with images stay queued, to follow the continue turn.
function takeHeldChat(sessionId: string, pauseId: number): HeldMessage[] {
  const rows = db
    .prepare(
      `SELECT id, text, sent_by FROM chat_queue
       WHERE session_id = ? AND images IS NULL AND id NOT LIKE 'pause-resume:%'
       ORDER BY position, created_at`
    )
    .all(sessionId) as { id: string; text: string; sent_by: string | null }[];
  if (rows.length)
    db.prepare(
      `DELETE FROM chat_queue WHERE session_id = ? AND id IN (${rows.map(() => "?").join(",")})`
    ).run(sessionId, ...rows.map((r) => r.id));
  db.prepare(`UPDATE task_pauses SET held_count = ? WHERE id = ?`).run(
    rows.length,
    pauseId
  );
  return rows.map((r) => ({
    from: (r.sent_by && SENT.exec(r.sent_by)?.[1]) || "the user",
    text: r.text,
  }));
}

function takeHeldBus(sessionId: string, pauseId: number): HeldMessage[] {
  const rows = db
    .prepare(
      `SELECT from_name, body FROM bus_messages
       WHERE to_id = ? AND held_pause_id = ? AND delivered_at IS NULL ORDER BY id`
    )
    .all(sessionId, pauseId) as { from_name: string; body: string }[];
  db.prepare(`UPDATE task_pauses SET held_count = ? WHERE id = ?`).run(
    rows.length,
    pauseId
  );
  return rows.map((r) => ({ from: r.from_name, text: r.body }));
}

const clock = (t: string | null) =>
  new Date(ms(t) || Date.now()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

export const resumeItemId = (pauseId: number) => `pause-resume:${pauseId}`;

// The prompt a resuming session gets, with what was held folded in.
function buildPrompt(row: TaskPause, held: HeldMessage[]): string {
  return continuePrompt({
    pausedAt: clock(row.paused_at),
    by: row.by_kind,
    duration: durationText(
      ms(row.requested_at),
      row.until_at ? ms(row.until_at) : null
    ),
    interrupted: !!row.interrupted,
    held,
  });
}

// A paused session resumes: one prompt with everything held folded in.
export async function claimResume(
  sessionId: string,
  opts: { reason?: string; force?: boolean } = {}
): Promise<"resumed" | "gone"> {
  const row = activePause(sessionId);
  const s = sessionOf(sessionId);
  if (!row || row.state !== "paused" || !s) return "gone";
  const chat = s.view === "chat";
  let held: HeldMessage[] = [];
  let prompt = "";
  // One transaction: the claim, the held messages taken, and (for a chat)
  // the continue prompt queued first, so a restart in between finds it.
  const claimed = db.transaction(() => {
    const n = db
      .prepare(
        `UPDATE task_pauses SET state = 'resuming', resumed_at = datetime('now'),
           resume_by_kind = COALESCE(resume_by_kind, ?)
         WHERE id = ? AND state = 'paused'`
      )
      .run(opts.reason ?? "person", row.id).changes;
    if (!n) return false;
    held = chat
      ? takeHeldChat(sessionId, row.id)
      : takeHeldBus(sessionId, row.id);
    prompt = buildPrompt(row, held);
    if (chat)
      db.prepare(
        `INSERT OR IGNORE INTO chat_queue (id, session_id, position, text, images, image_count, sent_by, created_at)
         VALUES (?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM chat_queue WHERE session_id = ?), ?, NULL, 0, ?, ?)`
      ).run(
        resumeItemId(row.id),
        sessionId,
        sessionId,
        prompt,
        JSON.stringify({
          from: "AgentOS",
          origin: { kind: "event", label: "Resumed" },
        }),
        Date.now()
      );
    db.prepare(
      `UPDATE sessions SET pause_state = 'resuming', pause_note = NULL WHERE id = ?`
    ).run(sessionId);
    return true;
  })();
  if (!claimed) return "gone";
  if (chat) {
    await releaseChat(sessionId).catch((error) =>
      console.error("[pause] release:", error)
    );
    settleResume(sessionId);
  } else {
    try {
      await finishTerminalResume(s, row.id, prompt);
    } catch (error) {
      failResume(s, row.id, error);
      return "gone";
    }
  }
  say(
    s,
    `resumed:${row.id}`,
    `Task "${s.name}" resumed${held.length ? `; ${held.length} held message${held.length === 1 ? "" : "s"} went with it` : ""}.`
  );
  return "resumed";
}

// A relaunch that can't happen ends the pause with the reason shown, instead
// of leaving it stuck in resuming for the sweep to retry forever.
function failResume(s: Session, pauseId: number, error: unknown): void {
  console.error("[pause] relaunch:", error);
  const row = pauseRow(pauseId);
  if (row) endPause(row, "failed");
  db.prepare(
    `UPDATE bus_messages SET read_at = COALESCE(read_at, datetime('now'))
     WHERE held_pause_id = ? AND delivered_at IS NULL`
  ).run(pauseId);
  say(
    s,
    `resume-failed:${pauseId}`,
    `Task "${s.name}" could not be resumed: ${error instanceof Error ? error.message : String(error)}. Its held messages were not delivered; reopen it by hand.`
  );
}

async function finishTerminalResume(
  s: Session,
  pauseId: number,
  prompt: string
): Promise<void> {
  await relaunchTerminal(s, prompt);
  db.prepare(
    `UPDATE bus_messages SET delivered_at = COALESCE(delivered_at, datetime('now')) WHERE held_pause_id = ?`
  ).run(pauseId);
  endPause(pauseRow(pauseId)!, "resumed");
}

async function relaunchTerminal(s: Session, prompt: string): Promise<void> {
  if (!s.claude_session_id || !s.worktree_path)
    throw new Error("Its terminal conversation can't be resumed");
  const routed = resolveRole(sessionRole(s), {
    workspaceId: sessionWorkspace(s),
    override: taskOverride(s),
  });
  await killTmux(s.tmux_name).catch(() => undefined);
  await launchClaude({
    sessionId: s.id,
    tmuxName: s.tmux_name,
    cwd: s.worktree_path,
    model: routed.model,
    provider: routed.provider.id === "anthropic" ? null : routed.provider.id,
    prompt,
    brief: s.task_brief ?? undefined,
    resume: s.claude_session_id,
  });
}

// A chat's resume is done once its worker has taken the continue prompt.
function settleResume(sessionId: string): boolean {
  const row = activePause(sessionId);
  if (!row || row.state !== "resuming") return false;
  const queued = db
    .prepare(`SELECT 1 FROM chat_queue WHERE session_id = ? AND id = ?`)
    .get(sessionId, resumeItemId(row.id));
  if (queued) return false;
  endPause(row, "resumed");
  return true;
}

// What the sidebar, the API and the orchestrator show of a pause.
export function pauseViewOf(sessionId: string): PauseView | null {
  const row = activePause(sessionId);
  if (!row) return null;
  return {
    state: row.state === "ended" ? "paused" : row.state,
    until: row.until_at,
    by: row.by_kind,
    reason: row.reason,
  };
}

// One pass over every unfinished pause: drive the stops a restart cut off,
// mark what came due, finish the resumes whose prompt was taken, and end the
// pauses of sessions that are gone.
export async function sweepPauses(now = Date.now()): Promise<void> {
  const open = db
    .prepare(`SELECT * FROM task_pauses WHERE state != 'ended'`)
    .all() as TaskPause[];
  for (const row of open) {
    const s = sessionOf(row.session_id);
    if (!s || s.archived_at || (s.task_status && s.task_status !== "running")) {
      endPause(row, "finished");
      continue;
    }
    if (row.state === "pausing") {
      // A chat already stopped at its boundary needs no wait.
      if (!driving.has(row.id)) drive(row.session_id, row.id);
    } else if (row.state === "paused") {
      if (!row.resume_requested_at && row.until_at && ms(row.until_at) <= now) {
        if (row.by_kind !== "person" && s.project_id) {
          const ws = getProject(s.project_id)?.workspace_id;
          // An orchestrator's or the scheduler's pause waits while the
          // orchestrator is paused; a person's pause ends on time.
          if (ws && isPaused(ws)) continue;
        }
        db.prepare(
          `UPDATE task_pauses SET resume_requested_at = datetime('now') WHERE id = ?`
        ).run(row.id);
        if (s.task_status) nudge();
        else await claimResume(row.session_id, { reason: "timer" });
      } else if (row.resume_requested_at && !s.task_status) {
        await claimResume(row.session_id, { reason: "timer" });
      }
    } else if (row.state === "resuming") {
      if (s.view === "chat") {
        if (!settleResume(row.session_id))
          await releaseChat(row.session_id).catch(() => undefined);
      } else if (statusDetector.sessionExists(s.tmux_name)) {
        endPause(row, "resumed");
      } else {
        // Cut off before the relaunch: held messages are still undelivered.
        await finishTerminalResume(
          s,
          row.id,
          buildPrompt(row, takeHeldBus(s.id, row.id))
        ).catch((error) => failResume(s, row.id, error));
      }
    }
  }
}

export function startPauseWatcher(): void {
  if (g.__agentosPauseTimer) return;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await sweepPauses();
    } catch (error) {
      console.error("[pause] sweep:", error);
    } finally {
      busy = false;
    }
  };
  g.__agentosPauseTimer = setInterval(() => void run(), SWEEP_MS);
  g.__agentosPauseTimer.unref?.();
  void run();
}

// For tests: forget which pauses this process is driving.
export const forgetDriving = () => driving.clear();
export { chatStateNow };
