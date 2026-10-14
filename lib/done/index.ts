/**
 * Done: finished work leaves the sidebar without being logged as rejected.
 * A task with an open PR merges first, only through the orchestrator's
 * gates at the judged head (refused, naming the gate, otherwise); one
 * already merged, or a session with no PR, just cleans up. Cleanup stops
 * the agent, removes the worktree only when nothing in it would be lost,
 * and marks the session finished so it sits on the Done shelf (archiving is
 * its own action, archive.ts). What it will do is decided first (plan.ts).
 */

import { endPauseOnFinish } from "../tasks/pause-hold";
import { db, queries, type Session } from "../db";
import { endSessionAgent } from "../sessions/end";
import { clearQueue } from "../chat/queued";
import { getProject } from "../projects";
import { mergeSettled, type TaskPR } from "../tasks";
import { syncTaskCardInBackground } from "../lumifyhub/task-cards";
import { statusDetector } from "../status-detector";
import { judge, mergeJudged } from "../orchestrator/signoff";
import { isPaused } from "../orchestrator/pause";
import { plain } from "../orchestrator/overview";
import { archiveSession } from "./archive";
import { settleSession } from "../sidebar/shelf-state";
import { demoMode } from "../security/demo";
import { planDone } from "./plan";
import { withTimeout } from "./deadline";
import { deleteMergedRemote } from "./remote";
import { settleWorktree, type WorktreeFate } from "./worktree";
import { sessionMergePolicy } from "../tasks/finish";
import { releasePorts } from "../ports";
import { dropSessionDatabase } from "../project-config/database";
import { doneOnPeer, peerSessionLink } from "../hosts/peer-actions";
import { hostLink } from "../hosts/remote-api";
import { doneHeldTask, isHeldRemote } from "../tasks/held-remote";
import { captureMergedTask } from "../session-logs";
import { sessionEnded } from "../experiments/hooks";
import { pushMerged } from "../notify/push/events";

export interface DoneOptions {
  // Who asked: the orchestrator's gate failures count toward Saad, as its
  // sign_off's do; a direct call's (UI, aos) don't.
  by: "orchestrator" | "direct";
  // The session asking, which can't mark itself done.
  callerId?: string | null;
  // Bulk clean-up: an open PR is refused, never merged.
  noMerge?: boolean;
  // Your own Done on the row: a linked machine's session is done there.
  // Agents and the orchestrator don't act on another machine's work.
  onPeer?: boolean;
}

export interface DoneOutcome {
  id: string;
  name: string;
  merged: string | null;
  worktree: WorktreeFate;
  text: string;
}

export function getDoneTarget(id: string): Session {
  const s = queries.getSession(db).get(id) as Session | undefined;
  if (!s) throw new Error("Session not found");
  return s;
}

async function stopAgent(s: Session): Promise<void> {
  await endSessionAgent(s);
  // Nothing is left to send them to; they'd only sit unread on a stopped agent.
  clearQueue(s.id);
  releasePorts(s.id);
  // Never waited on: the row is read now, and Postgres can't hold this up.
  void dropSessionDatabase(s.id);
}

function worktreeLine(f: WorktreeFate): string {
  if (f.action === "removed") return `worktree removed (${f.why})`;
  if (f.action === "gone") return `worktree ${f.why}`;
  if (f.action === "kept") return `worktree kept at ${f.path}: ${f.why}`;
  return "no worktree";
}

// Merges an open PR through the gates, or throws the failing gate.
async function mergeThroughGates(
  s: Session,
  pr: TaskPR,
  opts: DoneOptions
): Promise<{ text: string; sha: string }> {
  const w = s.project_id ? getProject(s.project_id)?.workspace_id : null;
  if (!w)
    throw new Error(
      `${s.name} has an open PR (#${pr.number}) and its project isn't in a workspace, so no orchestrator gate can pass it. Sign it off or drop it in Tasks.`
    );
  if (isPaused(w))
    throw new Error(
      `${s.name} has an open PR (#${pr.number}) and the orchestrator is paused: nothing merges until it resumes.`
    );
  const verdict = await judge(w, s, false, {
    count: opts.by === "orchestrator",
  });
  if (!verdict.ok) {
    const text =
      opts.by === "orchestrator" ? verdict.text : plain(verdict.text);
    throw new Error(`Not done, nothing merged. ${text}`);
  }
  const said = await mergeJudged(w, s, verdict, { wait: true });
  await mergeSettled(s.id);
  return { text: said, sha: verdict.sha };
}

function mark(s: Session, status: "merged" | "done", pr: TaskPR | null) {
  db.prepare(
    status === "merged"
      ? `UPDATE sessions SET task_status = 'merged', pr_status = 'merged' WHERE id = ?`
      : `UPDATE sessions SET task_status = 'done' WHERE id = ?`
  ).run(s.id);
  endPauseOnFinish(s.id);
  syncTaskCardInBackground(s, status, pr);
  void sessionEnded(s.id, status);
  if (status === "merged") {
    pushMerged(s.id);
    void captureMergedTask(s.id, { head: pr?.head });
  }
}

export async function doneSession(
  id: string,
  opts: DoneOptions
): Promise<DoneOutcome> {
  const s = getDoneTarget(id);
  // A demo archives and nothing more: no merge, no agent to stop, no
  // worktree to touch.
  if (demoMode()) {
    if (s.role === "orchestrator")
      throw new Error("An orchestrator isn't marked done.");
    if (s.archived_at) throw new Error(`${s.name} is already archived.`);
    if (s.task_prompt)
      db.prepare(`UPDATE sessions SET task_status = 'done' WHERE id = ?`).run(
        s.id
      );
    archiveSession(s.id);
    return {
      id: s.id,
      name: s.name,
      merged: null,
      worktree: { action: "none" },
      text: `${s.name} archived. In the demo, nothing is merged or cleaned up.`,
    };
  }
  // A linked machine's session is done there, by its own AgentOS.
  const peer = peerSessionLink(s);
  if (peer && !opts.onPeer)
    throw new Error(
      `${s.name} runs on ${peer.hostName}: only you can mark it done, from its row.`
    );
  if (peer) return doneOnPeer(peer, s);
  // A sign-off just before this (the orchestrator's sign_off, then done)
  // is still cleaning up in the background: read what it leaves.
  await mergeSettled(s.id);
  // A quick change has no tmux session, and a listing that stalls (a slow
  // ssh host, a loaded tmux) must not hold up a merge that doesn't read it.
  if (!s.quick_of) await withTimeout(statusDetector.refreshCache(), 10_000);
  const plan = await planDone(s, opts.callerId);
  if (plan.action === "refuse") throw new Error(plan.reason);
  if (plan.action === "merge" && opts.noMerge)
    throw new Error(
      `${s.name} has an open PR #${plan.pr.number}: a clean-up never merges, so Done it on its own to merge it through the gates.`
    );

  const notes: string[] = [];
  let merged: string | null = null;
  let worktree: WorktreeFate;
  if (plan.action === "merge") {
    const m = await mergeThroughGates(s, plan.pr, opts);
    merged = m.text;
    await stopAgent(s);
    // The sign-off's cleanup has already settled it; this reads the result.
    worktree = await settleWorktree(s, { prHead: m.sha });
  } else if (isHeldRemote(s)) {
    // Moved to a linked machine by its orchestrator: that machine stops the
    // agent and removes the worktree, which is where they are.
    await doneHeldTask(s);
    if (plan.mark) mark(s, plan.mark, plan.pr);
    else
      db.prepare(
        `UPDATE sessions SET task_status = 'done' WHERE id = ? AND task_status = 'running'`
      ).run(s.id);
    worktree = {
      action: "removed",
      why: `on ${hostLink(s.host_id)?.hostName ?? "its machine"}`,
    };
  } else {
    if (plan.mark) mark(s, plan.mark, plan.pr);
    if (
      plan.mark === "merged" &&
      sessionMergePolicy(s).delete_remote_branch &&
      (await deleteMergedRemote(s, plan.pr))
    )
      notes.push("its merged branch deleted on origin");
    await stopAgent(s);
    worktree = await settleWorktree(s, plan.merged);
  }
  settleSession(s.id);
  const head = merged ?? `Done: ${s.name}.`;
  const extra = notes.length ? `, ${notes.join(", ")}` : "";
  return {
    id: s.id,
    name: s.name,
    merged,
    worktree,
    text: `${head} Agent stopped, ${worktreeLine(worktree)}${extra}.`,
  };
}
