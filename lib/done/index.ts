/**
 * Done: finished work leaves the sidebar without being logged as rejected.
 * A task with an open PR merges first, only through the orchestrator's
 * gates at the judged head (refused, naming the gate, otherwise); one
 * already merged, or a session with no PR, just cleans up. Cleanup stops
 * the agent, removes the worktree only when nothing in it would be lost,
 * and archives the session. What it will do is decided first (plan.ts).
 */

import fs from "fs";
import { db, queries, type Session } from "../db";
import { stopChat } from "../chat/runner";
import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { getProject } from "../projects";
import { mergeSettled, type TaskPR } from "../tasks";
import { syncTaskCardInBackground } from "../lumifyhub/task-cards";
import { statusDetector } from "../status-detector";
import { judge, mergeJudged } from "../orchestrator/signoff";
import { isPaused } from "../orchestrator/pause";
import { plain } from "../orchestrator/overview";
import { archiveSession } from "./archive";
import { demoMode } from "../security/demo";
import { planDone } from "./plan";
import { deleteMergedRemote } from "./remote";
import { settleWorktree, type WorktreeFate } from "./worktree";
import { releasePorts } from "../ports";

export interface DoneOptions {
  // Who asked: the orchestrator's gate failures count toward Saad, as its
  // sign_off's do; a direct call's (UI, aos) don't.
  by: "orchestrator" | "direct";
  // The session asking, which can't mark itself done.
  callerId?: string | null;
  // Bulk clean-up: an open PR is refused, never merged.
  noMerge?: boolean;
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
  stopChat(s.id);
  await hostExec(
    s.host_id,
    `tmux kill-session -t ${shellQuote(`=${s.tmux_name}`)} 2>/dev/null || true`
  ).catch(() => {});
  releasePorts(s.id);
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
  syncTaskCardInBackground(s, status, pr);
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
  await statusDetector.refreshCache();
  const plan = await planDone(s, opts.callerId);
  if (plan.action === "refuse") throw new Error(plan.reason);
  if (plan.action === "merge" && opts.noMerge)
    throw new Error(
      `${s.name} has an open PR #${plan.pr.number}: a clean-up never merges, so Done it on its own to merge it through the gates.`
    );

  const hadWorktree = !!s.worktree_path && fs.existsSync(s.worktree_path);
  const notes: string[] = [];
  let merged: string | null = null;
  let worktree: WorktreeFate;
  if (plan.action === "merge") {
    const m = await mergeThroughGates(s, plan.pr, opts);
    merged = m.text;
    await stopAgent(s);
    // The sign-off's cleanup has already settled it; this reads the result.
    worktree = await settleWorktree(s, { prHead: m.sha });
  } else {
    if (plan.mark) mark(s, plan.mark, plan.pr);
    if (plan.mark === "merged" && (await deleteMergedRemote(s, plan.pr)))
      notes.push("its merged branch deleted on origin");
    await stopAgent(s);
    worktree = await settleWorktree(s, plan.merged);
  }
  if (
    hadWorktree &&
    worktree.action === "none" &&
    !fs.existsSync(s.worktree_path!)
  )
    worktree = { action: "removed", why: "its branch is merged" };
  archiveSession(s.id);
  const head = merged ?? `Done: ${s.name}.`;
  const extra = notes.length ? `, ${notes.join(", ")}` : "";
  return {
    id: s.id,
    name: s.name,
    merged,
    worktree,
    text: `${head} Agent stopped, ${worktreeLine(worktree)}${extra}; archived.`,
  };
}
