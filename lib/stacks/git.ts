/**
 * The git and gh side of a restack, ported from dispatch's `restack`. Every
 * command goes through an injected runner, so the sequence is testable with
 * a fake and provable against a real repository.
 *
 * Only the CHILD's branch is ever pushed, with a lease on the exact commit
 * fetched, so a push from anywhere else in between is refused rather than
 * overwritten.
 */

import fs from "fs";

// Runs a command and resolves stdout, or rejects with what it printed.
export type Runner = (
  cmd: string,
  args: string[],
  cwd: string
) => Promise<string>;

export interface RestackMove {
  name: string;
  repo: string;
  worktree: string | null;
  branch: string;
  // The parent commit this branch was cut from (or last restacked onto).
  oldTip: string;
  // The branch it moves onto: the default branch, or its parent's rewritten one.
  onto: string;
  // Retarget the PR to `onto` first (the parent merged and its branch goes).
  retargetPr: number | null;
}

export type RestackResult =
  | { ok: true; newTip: string; message: string }
  | { ok: false; error: string };

export function outputOf(error: unknown): string {
  const e = error as { stderr?: string; stdout?: string; message?: string };
  return (
    `${e.stderr || ""}${e.stdout || ""}`.trim() || e.message || String(error)
  );
}

async function attempt(
  runner: Runner,
  cmd: string,
  args: string[],
  cwd: string
) {
  try {
    return { ok: true as const, out: (await runner(cmd, args, cwd)).trim() };
  } catch (error) {
    return { ok: false as const, out: outputOf(error) };
  }
}

export async function restackBranch(
  m: RestackMove,
  runner: Runner
): Promise<RestackResult> {
  const fail = (error: string): RestackResult => ({ ok: false, error });
  const wt = m.worktree;
  if (!wt || !fs.existsSync(wt)) return fail(`${m.name}: its worktree is gone`);
  const dirty = await attempt(runner, "git", ["status", "--porcelain"], wt);
  if (!dirty.ok || dirty.out) {
    return fail(
      `${m.name} has uncommitted changes in ${wt}. Commit them, then restack again.`
    );
  }
  const target = `origin/${m.onto}`;
  const newTip = await attempt(
    runner,
    "git",
    ["rev-parse", "--verify", "--quiet", target],
    m.repo
  );
  if (!newTip.ok) return fail(`${m.name}: ${target} does not exist`);
  const remote = await attempt(
    runner,
    "git",
    ["rev-parse", "--verify", "--quiet", `origin/${m.branch}`],
    m.repo
  );
  if (remote.ok) {
    const behind = await attempt(
      runner,
      "git",
      ["merge-base", "--is-ancestor", remote.out, m.branch],
      wt
    );
    if (!behind.ok) {
      return fail(
        `${m.name}: origin/${m.branch} has commits this worktree does not. Pull them first; a rebase would drop them.`
      );
    }
  }
  if (!m.retargetPr && newTip.out === m.oldTip) {
    return {
      ok: true,
      newTip: newTip.out,
      message: `${m.name} is already on the latest ${m.onto}`,
    };
  }

  // Retarget BEFORE the rebase: once the parent's branch is deleted, a PR
  // still based on it is closed by GitHub, and a closed PR cannot be
  // retargeted.
  if (m.retargetPr) {
    const edit = await attempt(
      runner,
      "gh",
      ["pr", "edit", String(m.retargetPr), "--base", m.onto],
      m.repo
    );
    if (!edit.ok)
      return fail(
        `${m.name}: could not retarget PR #${m.retargetPr}: ${edit.out.slice(0, 200)}`
      );
  }

  // Already on the new base (someone resolved a conflict by hand): no rebase.
  const onIt = await attempt(
    runner,
    "git",
    ["merge-base", "--is-ancestor", target, "HEAD"],
    wt
  );
  if (!onIt.ok) {
    const rebase = await attempt(
      runner,
      "git",
      ["rebase", "--onto", target, m.oldTip],
      wt
    );
    if (!rebase.ok) {
      await attempt(runner, "git", ["rebase", "--abort"], wt);
      return fail(
        `${m.name}: rebasing onto ${target} conflicts. Resolve it with \`cd ${wt} && git rebase --onto ${target} ${m.oldTip}\`, push with \`git push --force-with-lease origin ${m.branch}\`, then restack again.`
      );
    }
  }

  if (remote.ok) {
    const head = await attempt(runner, "git", ["rev-parse", "HEAD"], wt);
    if (head.ok && head.out !== remote.out) {
      // --no-verify: CI runs on the PR, and a pre-push suite would stall
      // the server for minutes.
      const push = await attempt(
        runner,
        "git",
        [
          "push",
          "--no-verify",
          `--force-with-lease=${m.branch}:${remote.out}`,
          "origin",
          m.branch,
        ],
        wt
      );
      if (!push.ok)
        return fail(
          `${m.name}: rebased locally, push refused: ${push.out.slice(0, 200)}`
        );
    }
  }
  const retargeted = m.retargetPr ? ` and retargeted PR #${m.retargetPr}` : "";
  return {
    ok: true,
    newTip: newTip.out,
    message: `${m.name} rebased onto ${m.onto}${retargeted}`,
  };
}
