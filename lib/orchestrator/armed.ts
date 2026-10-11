/**
 * Arming: AgentOS merges a task's PR itself the moment every gate passes at
 * its current head, so nobody polls sign_off. It is sign_off's own judgement
 * and merge (signoff.ts), run on the watcher's diffs, and judged again only
 * when something the gates read has moved (or every few minutes), so an
 * armed task waiting on CI costs nothing.
 *
 * The orchestrator hears one event: merged, or a failure. A failure is
 * counted against the task once per head, as sign_off would count it, and
 * reported once; the task stays armed for its fix. One that goes to Saad
 * disarms it, since only he merges it from then on. The flag is in the
 * database, so it survives a restart.
 */

import { db, type Session } from "../db";
import type { TaskPR } from "../tasks/state";
import { latestApproval } from "./ask-approvals";
import { openBySubject, workSubject } from "./asks";
import { getCheck } from "./checks";
import { markTold, queueEvent } from "./events";
import type { SessionFacts } from "./facts";
import { holdingEscalations } from "./gates";
import { getOrchestrator } from "./home";
import { isPaused } from "./pause";
import { review } from "./review";
import { judge, mergeJudged } from "./signoff";
import { workspaceTask } from "./targets";

// Judged again at least this often, for what the fingerprint can't see.
export const ARMED_RECHECK_MS = 5 * 60 * 1000;

const short = (sha: string) => sha.slice(0, 7);

export function setArmed(sessionId: string, armed: boolean): void {
  db.prepare(
    `UPDATE sessions SET merge_armed_at = ${armed ? "COALESCE(merge_armed_at, datetime('now'))" : "NULL"},
       merge_armed_seen = NULL WHERE id = ?`
  ).run(sessionId);
  looked.delete(sessionId);
}

// The workspace a task's PR merges through when armed: its project's, with
// an orchestrator to tell. Null when it has none.
export function armingWorkspace(task: Session): string | null {
  const row = db
    .prepare(`SELECT workspace_id FROM projects WHERE id = ?`)
    .get(task.project_id) as { workspace_id: string | null } | undefined;
  const w = row?.workspace_id;
  return w && getOrchestrator(w) ? w : null;
}

function armedTasks(workspaceId: string): Session[] {
  return db
    .prepare(
      `SELECT s.* FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.merge_armed_at IS NOT NULL
         AND s.task_status = 'running' AND s.peer_mirror = 0`
    )
    .all(workspaceId) as Session[];
}

// Read again right before each judgement and merge: Saad can pause the
// workspace or disarm the task while an earlier one waits on gh or git.
function stillArmed(workspaceId: string, taskId: string): boolean {
  if (isPaused(workspaceId)) return false;
  const row = db
    .prepare(`SELECT merge_armed_at FROM sessions WHERE id = ?`)
    .get(taskId) as { merge_armed_at: string | null } | undefined;
  return !!row?.merge_armed_at;
}

export const anyArmed = (workspaceId: string) =>
  armedTasks(workspaceId).length > 0;

// The orchestrator's `arm` and `disarm`.
export function arm(workspaceId: string, ref: string): string {
  const task = workspaceTask(workspaceId, ref);
  armTask(task);
  return `Armed ${task.name}: AgentOS merges its PR the moment every sign_off gate passes at its head, and tells you with one event. A gate failure also comes as one event; it stays armed for the fix, unless the failure goes to Saad. No need to call sign_off.`;
}

// Arms a task, or says why it can't be: only a running task, in a
// workspace whose orchestrator hears how it went, that isn't with Saad.
export function armTask(task: Session): void {
  if (task.task_status !== "running")
    throw new Error(`${task.name} is already ${task.task_status}`);
  const held = holdingEscalations(task.id);
  if (held.length)
    throw new Error(
      `${task.name} is with Saad (${held.map((h) => h.gate).join(", ")}); only he merges it`
    );
  const w = armingWorkspace(task);
  if (w && openBySubject(w, workSubject(task.id)))
    throw new Error(
      `${task.name} has an open ask with Saad; it merges on his answer`
    );
  if (task.peer_mirror)
    throw new Error(`${task.name} runs on a linked machine; arm it there`);
  if (!armingWorkspace(task))
    throw new Error(
      `${task.name}'s project isn't in a workspace with an orchestrator, which an armed merge reports to`
    );
  setArmed(task.id, true);
}

export function disarm(workspaceId: string, ref: string): string {
  const task = workspaceTask(workspaceId, ref);
  setArmed(task.id, false);
  return `Disarmed ${task.name}: it merges only through sign_off now.`;
}

// What the gates read, cheaply, from facts already gathered: unchanged
// means the verdict can't have changed either.
const looked = new Map<string, { fp: string; at: number }>();

function fingerprint(
  workspaceId: string,
  task: Session,
  f: SessionFacts,
  pr: TaskPR
): string {
  const head = pr.head ?? "";
  return [
    head,
    pr.checks,
    (f.task?.ciSettleIn ?? 0) > 0,
    getCheck(task.id, head, "review")?.status,
    getCheck(task.id, head, "scope")?.status,
    pr.codeReview?.sha,
    pr.codeReview?.attribution,
    f.task?.blocked,
    f.status,
    f.needsInput,
    task.rebased_to,
    latestApproval(workspaceId, workSubject(task.id))?.id,
  ].join("|");
}

// The failures in a verdict, without its waits (whose countdowns change).
const failures = (text: string) =>
  text
    .split("\n")
    .filter((l) => /^- [\w-]+ failed\b/.test(l))
    .join("\n") || text.split("\n")[0];

function event(workspaceId: string, task: Session, line: string) {
  queueEvent(workspaceId, `armed:${task.id}`, task.id, line);
}

export interface ArmedDeps {
  judge: typeof judge;
  merge: typeof mergeJudged;
  review: (workspaceId: string, taskId: string) => Promise<unknown>;
}

const defaults: ArmedDeps = {
  judge,
  merge: mergeJudged,
  review: (w, id) => review(w, id),
};

// Merges every armed task in the workspace whose gates all pass now.
export async function mergeArmed(
  workspaceId: string,
  facts: SessionFacts[],
  deps: ArmedDeps = defaults,
  now = Date.now()
): Promise<void> {
  if (isPaused(workspaceId)) return;
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const task of armedTasks(workspaceId)) {
    const f = byId.get(task.id);
    const pr = f?.task?.pr;
    // No PR yet: it merges once it has one.
    if (!f || !pr) continue;
    try {
      await mergeOne(workspaceId, task, f, pr, deps, now);
    } catch (error) {
      console.error(`Armed merge of ${task.name}:`, error);
    }
  }
}

async function mergeOne(
  workspaceId: string,
  task: Session,
  f: SessionFacts,
  pr: TaskPR,
  deps: ArmedDeps,
  now: number
): Promise<void> {
  if (pr.state !== "OPEN") {
    setArmed(task.id, false);
    if (pr.state === "CLOSED")
      event(
        workspaceId,
        task,
        `task ${task.name}: disarmed, its PR #${pr.number} was closed`
      );
    return;
  }
  // With Saad, on a gate or on a question about it: he decides, so it
  // doesn't merge by itself meanwhile.
  const held = holdingEscalations(task.id).map((h) => h.gate);
  if (!held.length && openBySubject(workspaceId, workSubject(task.id)))
    held.push("an open ask");
  if (held.length) {
    setArmed(task.id, false);
    event(
      workspaceId,
      task,
      `task ${task.name}: disarmed, it's with Saad (${held.join(", ")})`
    );
    return;
  }
  const fp = fingerprint(workspaceId, task, f, pr);
  const last = looked.get(task.id);
  if (last?.fp === fp && now - last.at < ARMED_RECHECK_MS) return;
  looked.set(task.id, { fp, at: now });

  if (!stillArmed(workspaceId, task.id)) return;
  const verdict = await deps.judge(workspaceId, task, false, { count: false });
  if (verdict.ok) return merge(workspaceId, task, verdict, deps);
  if (verdict.wait) {
    // CI is green and no one has reviewed this commit: start it, as land does.
    if (pr.checks === "pass" && verdict.text.includes("call review"))
      await deps.review(workspaceId, task.id).catch(() => {});
    return;
  }
  const seen = `${pr.head}:${failures(verdict.text)}`;
  if (task.merge_armed_seen === seen) return;
  // Counted as sign_off would count it: once per head (the database keys
  // it), and a gate failing on a second commit goes to Saad.
  if (!stillArmed(workspaceId, task.id)) return;
  const counted = await deps.judge(workspaceId, task);
  if (counted.ok) return merge(workspaceId, task, counted, deps);
  const toSaad = holdingEscalations(task.id).length > 0;
  if (toSaad) setArmed(task.id, false);
  else
    db.prepare(`UPDATE sessions SET merge_armed_seen = ? WHERE id = ?`).run(
      seen,
      task.id
    );
  event(
    workspaceId,
    task,
    toSaad
      ? `task ${task.name}: armed merge stopped and disarmed, it went to Saad.\n${counted.text}`
      : `task ${task.name}: armed, not merged yet; it stays armed and merges once this is fixed.\n${counted.text}`
  );
}

async function merge(
  workspaceId: string,
  task: Session,
  verdict: Extract<Awaited<ReturnType<typeof judge>>, { ok: true }>,
  deps: ArmedDeps
): Promise<void> {
  if (!stillArmed(workspaceId, task.id)) return;
  let text: string;
  try {
    text = await deps.merge(workspaceId, task, verdict);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    const seen = `${verdict.sha}:merge:${why}`;
    if (task.merge_armed_seen === seen) return;
    db.prepare(`UPDATE sessions SET merge_armed_seen = ? WHERE id = ?`).run(
      seen,
      task.id
    );
    event(
      workspaceId,
      task,
      `task ${task.name}: armed, every gate passed at ${short(verdict.sha)} but the merge was refused: ${why.slice(0, 300)}. It stays armed.`
    );
    return;
  }
  setArmed(task.id, false);
  // The merged condition would say it again on the next diff.
  markTold(workspaceId, `merged:${task.id}`, task.id);
  event(
    workspaceId,
    task,
    `task ${task.name}: ${text} (armed: every gate passed)`
  );
}
