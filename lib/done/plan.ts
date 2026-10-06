/**
 * What done would do with a session, decided without touching anything:
 * refuse (and why), merge an open PR through the gates, or clean up. A
 * single done acts on it; the bulk preview shows it.
 */

import { db, stackQueries as sq, type Session } from "../db";
import type { TaskPR } from "../tasks";
import { prFor } from "../tasks/session";
import { statusOf } from "../orchestrator/facts";
import { worktreeFate, type FatePreview, type MergedAs } from "./worktree";

export type DonePlan =
  | { action: "refuse"; reason: string }
  | { action: "merge"; pr: TaskPR }
  | {
      action: "cleanup";
      // What the task becomes: merged on GitHub, or done without a merge.
      mark: "merged" | "done" | null;
      pr: TaskPR | null;
      merged: MergedAs | null;
      worktree: FatePreview;
    };

const LIVE_ITEM = new Set(["starting", "running", "pr"]);

const refuse = (reason: string): DonePlan => ({ action: "refuse", reason });

// gh's errors run to several lines (the command, then why): the why.
function message(e: unknown): string {
  const lines = (e instanceof Error ? e.message : String(e))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const why = lines.find((l) => !l.startsWith("Command failed")) ?? lines[0];
  return (why ?? "unknown error").slice(0, 200);
}

async function cleanup(
  s: Session,
  mark: "merged" | "done" | null,
  pr: TaskPR | null,
  merged: MergedAs | null
): Promise<DonePlan> {
  return {
    action: "cleanup",
    mark,
    pr,
    merged,
    worktree: await worktreeFate(s, merged),
  };
}

// The task's PR as GitHub has it now. A lookup that fails, or one that
// finds nothing for a task known to have had a PR, can't rule out an open
// PR, so it refuses rather than finishing the task as done.
async function taskPlan(s: Session): Promise<DonePlan> {
  let pr: TaskPR | null;
  try {
    pr = await prFor(s, true, true);
  } catch (e) {
    return refuse(
      `${s.name}'s PR couldn't be read from GitHub (${message(e)}), so an open one can't be ruled out`
    );
  }
  if (!pr && (s.pr_number || s.pr_url))
    return refuse(
      `${s.name} had ${s.pr_number ? `PR #${s.pr_number}` : "a PR"} but GitHub doesn't return it now; nothing is done until it can be checked`
    );
  if (pr?.state === "OPEN") return { action: "merge", pr };
  if (pr?.state === "MERGED")
    return cleanup(s, "merged", pr, { prHead: pr.head ?? null });
  const item = sq.itemForSession(db, s.id);
  if (item && LIVE_ITEM.has(item.status))
    return refuse(
      `${s.name} is a card in a running stack and the cards after it wait on its merge: sign it off or drop it`
    );
  return cleanup(s, "done", pr, null);
}

export async function planDone(
  s: Session,
  callerId?: string | null
): Promise<DonePlan> {
  if (s.role === "orchestrator")
    return refuse(`${s.name} is a workspace's orchestrator; it can't be done`);
  if (s.archived_at) return refuse(`${s.name} is already done`);
  if (callerId && callerId === s.id)
    return refuse("A session can't mark itself done");
  if ((await statusOf(s)).status === "running")
    return refuse(`${s.name} is still working: wait for it, or stop it first`);
  if (s.task_status === "running") return taskPlan(s);
  if (s.task_status === "merged") return cleanup(s, null, null, {});
  return cleanup(s, null, null, null);
}

// One line for the preview: what done will do with it.
export function planLine(p: DonePlan): string {
  if (p.action === "refuse") return p.reason;
  if (p.action === "merge")
    return `has an open PR #${p.pr.number}: Done it on its own to merge it through the gates`;
  const w = p.worktree;
  const tree =
    w.action === "remove"
      ? `remove its worktree (${w.why})`
      : w.action === "kept"
        ? `keep its worktree: ${w.why}`
        : "no worktree";
  return `stop it, ${tree}, archive it`;
}
