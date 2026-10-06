/**
 * Done: finished work leaves the sidebar without being logged as rejected.
 * A task with an open PR merges first, only through the orchestrator's
 * gates at the judged head (refused, naming the gate, otherwise); one
 * already merged, or a session with no PR, just cleans up. Cleanup stops
 * the agent, removes the worktree only when nothing in it would be lost,
 * and archives the session.
 */

import fs from "fs";
import { db, queries, stackQueries as sq, type Session } from "../db";
import { stopChat } from "../chat/runner";
import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { getProject } from "../projects";
import { mergeSettled, type TaskPR } from "../tasks";
import { prFor } from "../tasks/session";
import { syncTaskCardInBackground } from "../lumifyhub/task-cards";
import { statusOf } from "../orchestrator/facts";
import { judge, mergeJudged } from "../orchestrator/signoff";
import { isPaused } from "../orchestrator/pause";
import { plain } from "../orchestrator/overview";
import { archiveSession } from "./archive";
import { settleWorktree, type WorktreeFate } from "./worktree";

export interface DoneOptions {
  // Who asked: the orchestrator's gate failures count toward Saad, as its
  // sign_off's do; a direct call's (UI, aos) don't.
  by: "orchestrator" | "direct";
  // The session asking, which can't mark itself done.
  callerId?: string | null;
}

export interface DoneOutcome {
  id: string;
  name: string;
  merged: string | null;
  worktree: WorktreeFate;
  text: string;
}

const LIVE_ITEM = new Set(["starting", "running", "pr"]);

export function getDoneTarget(id: string): Session {
  const s = queries.getSession(db).get(id) as Session | undefined;
  if (!s) throw new Error("Session not found");
  return s;
}

async function stopAgent(s: Session): Promise<void> {
  stopChat(s.id);
  await hostExec(
    s.host_id,
    `tmux kill-session -t ${shellQuote(`=${s.tmux_name}`)} 2>/dev/null || true`
  ).catch(() => {});
  if (s.dev_server_port)
    db.prepare(`UPDATE sessions SET dev_server_port = NULL WHERE id = ?`).run(
      s.id
    );
}

function worktreeLine(f: WorktreeFate): string {
  if (f.action === "removed") return `worktree removed (${f.why})`;
  if (f.action === "kept") return `worktree kept at ${f.path}: ${f.why}`;
  return "no worktree";
}

// Merges an open PR through the gates, or throws the failing gate.
async function mergeThroughGates(
  s: Session,
  pr: TaskPR,
  opts: DoneOptions
): Promise<string> {
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
  return said;
}

// A task with no PR to merge ends as done; one in a running stack can't,
// since the cards above it wait on its merge.
function finishUnmerged(s: Session): void {
  const item = sq.itemForSession(db, s.id);
  if (item && LIVE_ITEM.has(item.status))
    throw new Error(
      `${s.name} is a card in a running stack and the cards after it wait on its merge: sign it off or drop it.`
    );
  db.prepare(`UPDATE sessions SET task_status = 'done' WHERE id = ?`).run(s.id);
  syncTaskCardInBackground(s, "done", null);
}

export async function doneSession(
  id: string,
  opts: DoneOptions
): Promise<DoneOutcome> {
  const s = getDoneTarget(id);
  if (s.role === "orchestrator")
    throw new Error(
      `${s.name} is a workspace's orchestrator; it can't be done`
    );
  if (s.archived_at) throw new Error(`${s.name} is already done`);
  if (opts.callerId && opts.callerId === s.id)
    throw new Error("A session can't mark itself done");
  if ((await statusOf(s)).status === "running")
    throw new Error(
      `${s.name} is still working: wait for it, or stop it first`
    );

  const hadWorktree = !!s.worktree_path && fs.existsSync(s.worktree_path);
  let merged: string | null = null;
  let branchMerged = false;
  if (s.task_status === "running") {
    const pr = await prFor(s, true);
    if (pr?.state === "OPEN") {
      merged = await mergeThroughGates(s, pr, opts);
      branchMerged = true;
    } else if (pr?.state === "MERGED") {
      db.prepare(
        `UPDATE sessions SET task_status = 'merged', pr_status = 'merged' WHERE id = ?`
      ).run(s.id);
      syncTaskCardInBackground(s, "merged", pr);
      branchMerged = true;
    } else finishUnmerged(s);
  } else if (s.task_status === "merged") branchMerged = true;

  await stopAgent(s);
  let worktree = await settleWorktree(s, branchMerged);
  // A sign-off's own cleanup has already removed it.
  if (merged && hadWorktree && worktree.action === "none")
    worktree = { action: "removed", why: "its branch is merged" };
  archiveSession(s.id);
  const head = merged ?? `Done: ${s.name}.`;
  return {
    id: s.id,
    name: s.name,
    merged,
    worktree,
    text: `${head} Agent stopped, ${worktreeLine(worktree)}; archived.`,
  };
}
