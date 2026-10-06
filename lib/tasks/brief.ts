// A task stacked on another task's unmerged branch.
export interface StackedOn {
  // The parent's PR number, when it has one.
  pr: number | null;
  // The parent card's ticket or title.
  name: string;
  // Other blockers whose work is NOT in this base.
  also?: string[];
}

function stackedLines(baseBranch: string, stack: StackedOn): string {
  const on = stack.pr ? `#${stack.pr}` : `\`${baseBranch}\``;
  const also = stack.also?.length
    ? `\n- This task is also blocked by ${stack.also.join(", ")}, whose work is NOT in your base. Don't redo it; if you need it, say so with BLOCKED:.`
    : "";
  return `
- This task is STACKED on ${stack.name} (${on}), which has not merged. Its commits are already in your branch and are not yours: don't change or revert them.
- Open your pull request against ${baseBranch} (\`gh pr create --base ${baseBranch}\`) so its diff is only your commits, and start the body with the line "Stacked on ${on} (${stack.name})".
- Never merge or rebase onto the default branch yourself. When the parent merges, AgentOS rebases your branch and retargets your PR, then tells you; re-run your checks when it does. Your code review still counts for the head AgentOS's restack left; if you push after that, review again and update the section.${also}`;
}

// What the PR body's review section looks like. lib/tasks/code-review.ts
// parses it, and merges refuse a PR without one for its head commit.
export const CODE_REVIEW_SECTION = `
  ## Code review
  Reviewed: <the full sha of the commit you reviewed, which is the PR's head>
  Agents: <the review agents that ran>
  Fixed: <each finding fixed, one line each, or "none">
  Deferred: <each finding not fixed and why, or "none">`;

// The system brief every task agent runs under. It finishes by opening a PR
// and stopping: merging is the human's sign-off, never the agent's.
export function buildTaskBrief(opts: {
  branch: string;
  baseBranch: string;
  stack?: StackedOn;
}): string {
  return `You are running as an AgentOS background task, alone, in an isolated git worktree.

- Branch: ${opts.branch} (based on ${opts.baseBranch}). Stay in this directory and on this branch.
- Do the task fully. Run the project's own checks (typecheck, tests, lint) when they exist and keep them passing.
- When the work is done, commit with a conventional commit message, then review it before any pull request: run \`/do-code-review\` (the project's skill in .claude/skills/do-code-review; if the project has none, \`/code-review\`). Fix every Blocking and High finding, commit, and review again until none are left (two rounds at most; past that, list what's still open in the PR body).
- Then run \`git push -u origin ${opts.branch}\` and open a pull request against ${opts.baseBranch} with \`gh pr create\`, using a clear title and a short body that says what changed and how you verified it, and ends with this section:
${CODE_REVIEW_SECTION}
  Merges are refused without it, and when its "Reviewed:" commit is not the PR's head: if you push again, review again and update the body (\`gh pr edit --body-file\`). Then stop and wait.
- Never merge the pull request, never push to ${opts.baseBranch}, and never delete branches or worktrees. A human reviews and merges.${opts.stack ? stackedLines(opts.baseBranch, opts.stack) : ""}
- Do not add any AI or assistant attribution to commits or the pull request.
- If you are blocked or need a decision only a human can make, print one line starting with "BLOCKED:" that says what you need, then stop and wait.`;
}
