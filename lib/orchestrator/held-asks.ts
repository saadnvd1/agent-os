// A gate that failed twice holds the task at once, but Saad's ask waits
// until the task's agent is done: idle, nothing sent to it lately, and CI
// settled on its latest head. Then the ask goes up at that head, the commit
// he'd merge; if the head moves after that, followAskHeads moves the same ask.

import { db, type Session } from "../db";
import { prFor } from "../tasks/session";
import { latestApproval } from "./ask-approvals";
import { askSaadAbout } from "./escalate";
import { getCheck } from "./checks";
import { openBySubject, workSubject } from "./asks";
import { recentlyMessaged } from "./conditions";
import type { SessionFacts } from "./facts";
import {
  failedTwiceWhy,
  heldAskFailures,
  releaseHeldAsks,
  type FailureRow,
} from "./gates";
import { getOrchestrator } from "./home";
import { commitTime, fetchRefs, repoOf } from "./repo";
import { ciSettleIn, SETTLE_S } from "./task-state";

// Long enough for the orchestrator to send the findings that caused the
// escalation; the hour is the most a stuck agent can hide an escalation.
export const HOLD_MIN_MS = SETTLE_S * 1000;
export const HOLD_MAX_MS = 60 * 60 * 1000;

const short = (sha: string) => sha.slice(0, 7);
const sqliteMs = (t: string) => Date.parse(`${t.replace(" ", "T")}Z`);

export async function raiseHeldAsks(
  workspaceId: string,
  facts: SessionFacts[],
  now = Date.now()
): Promise<void> {
  const byTask = new Map<string, FailureRow[]>();
  for (const row of heldAskFailures(workspaceId))
    byTask.set(row.session_id, [...(byTask.get(row.session_id) ?? []), row]);
  if (!byTask.size) return;
  const orch = getOrchestrator(workspaceId);
  const messaged = orch ? recentlyMessaged(orch.id, now) : new Set<string>();
  for (const [taskId, rows] of byTask) {
    try {
      await raiseFor(workspaceId, taskId, rows, facts, messaged, now);
    } catch (error) {
      console.error(`Raising ${taskId}'s held ask:`, error);
    }
  }
}

async function raiseFor(
  workspaceId: string,
  taskId: string,
  rows: FailureRow[],
  facts: SessionFacts[],
  messaged: Set<string>,
  now: number
): Promise<void> {
  const f = facts.find((x) => x.id === taskId);
  const task = db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(taskId) as Session | undefined;
  // Gone, merged or dropped: nothing left to ask. An open ask or an
  // unspent approval already covers it (followAskHeads, heldVerdict).
  if (
    !task ||
    task.task_status !== "running" ||
    openBySubject(workspaceId, workSubject(taskId)) ||
    latestApproval(workspaceId, workSubject(taskId))
  )
    return releaseHeldAsks(taskId);
  const heldFor =
    now - Math.min(...rows.map((r) => sqliteMs(r.ask_held_at as string)));
  const overdue = heldFor >= HOLD_MAX_MS;
  // No facts yet is a wait, but never past the hour.
  if (!f && !overdue) return;
  // A gh failure throws and keeps the hold: only GitHub saying the PR isn't
  // open releases it.
  const pr = await prFor(task, true, true);
  if (pr?.state !== "OPEN" || !pr.head) return releaseHeldAsks(taskId);
  if (!overdue && f) {
    if (f.status === "running" || f.compacting) return;
    if (messaged.has(taskId) || heldFor < HOLD_MIN_MS) return;
    if (getCheck(taskId, pr.head, "review")?.status === "running") return;
    const repo = repoOf(task);
    // The head may be a commit this clone hasn't fetched yet.
    await fetchRefs(repo, task);
    const committedAt = await commitTime(repo, pr.head);
    if (pr.checks === "pending") return;
    if (pr.checks === "pass") {
      const left = ciSettleIn({
        workspaceId,
        taskId,
        sha: pr.head,
        checkCount: pr.checkCount ?? 0,
        committedAt,
        now,
      });
      if (left > 0) return;
    } else if (now / 1000 - committedAt < SETTLE_S) return;
  }
  const last = rows.find((r) => r.last_sha)?.last_sha;
  const why = [
    ...rows.map((r) => failedTwiceWhy(r.gate, r.last_reason ?? "")),
    ...(last && last !== pr.head
      ? [
          `Asked at ${short(pr.head)}, its head after the fixes since ${short(last)}.`,
        ]
      : []),
    ...(overdue
      ? [`${task.name} was still working after an hour; this is its head now.`]
      : []),
  ].join("\n");
  askSaadAbout(workspaceId, task, why, pr.url, pr.head);
  releaseHeldAsks(taskId);
}
