/**
 * Brings a task's worktree up to date with its base before implementation
 * starts. A plan can wait days for approval, and the branch was cut when the
 * task was created. Runs wherever the task runs (a linked machine's own
 * AgentOS approves its own tasks), through the same runner as the restack.
 *
 * Never loses work: an empty branch moves to the base (untracked and ignored
 * files, like the plan, are left alone); a branch with work is rebased only
 * when that is clean, and a conflict is aborted and reported.
 */

import fs from "fs";
import { getDefaultBranch } from "../git";
import { git, gitOk } from "../git-exec";
import { restackBranch, outputOf, type Runner } from "../stacks/git";
import { run } from "./gh";

export type RefreshResult =
  | { moved: false; note?: string }
  | { moved: true; how: "reset" | "rebase" };

export interface RefreshTarget {
  name: string;
  worktree: string | null;
  branch: string | null;
  base: string | null;
}

const text = async (args: string[], cwd: string) =>
  (await git(cwd, args)).trim();

// `note` is set when the base moved but the branch couldn't follow it, for
// the implement prompt. The caller guarantees the agent is idle.
export async function refreshBase(
  t: RefreshTarget,
  runner: Runner = (cmd, args, cwd) => run(cmd, args, cwd, 120000)
): Promise<RefreshResult> {
  const wt = t.worktree;
  if (!wt || !t.branch || !fs.existsSync(wt)) return { moved: false };
  try {
    const base = t.base || (await getDefaultBranch(wt));
    const target = `origin/${base}`;
    await git(wt, ["fetch", "origin", base], { timeout: 120000 });
    const tip = await text(["rev-parse", "--verify", target], wt);
    const head = await text(["rev-parse", "HEAD"], wt);
    if (await gitOk(wt, ["merge-base", "--is-ancestor", tip, head]))
      return { moved: false };
    const mergeBase = await text(["merge-base", tip, head], wt);
    const moved = `${base} moved on after this branch was created`;
    if (head === mergeBase) {
      const tracked = await text(
        ["status", "--porcelain", "--untracked-files=no"],
        wt
      );
      if (!tracked) {
        await git(wt, ["reset", "--hard", tip]);
        return { moved: true, how: "reset" };
      }
    }
    const result = await restackBranch(
      {
        name: t.name,
        repo: wt,
        worktree: wt,
        branch: t.branch,
        oldTip: mergeBase,
        onto: base,
        retargetPr: null,
      },
      runner
    );
    if (result.ok) return { moved: true, how: "rebase" };
    return { moved: false, note: `${moved}; it could not be rebased` };
  } catch (error) {
    console.error(`Refreshing ${t.name}'s base failed:`, outputOf(error));
    return { moved: false };
  }
}
