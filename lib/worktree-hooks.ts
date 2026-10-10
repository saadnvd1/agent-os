/**
 * Git hooks for the worktrees AgentOS creates: a commit-msg hook that strips
 * AI attribution from every commit message, without taking away any hook the
 * project already runs.
 *
 * A hook and not a brief line, because the brief line kept losing: Claude
 * Code adds `Co-Authored-By: Claude` by default and a mid-session reminder
 * tells the agent to, which beats one sentence in a brief.
 *
 * `core.hooksPath` is shared repository config, so pointing it at this
 * folder for one worktree would repoint the main checkout and every other
 * worktree too, and turn their husky hooks off. It is set with `--worktree`
 * instead (which needs `extensions.worktreeConfig`), and the folder holds a
 * wrapper for every hook husky knows that runs the project's own hook, so
 * adding one hook never removes another. The folder lives in the worktree's
 * own git directory, so it goes when the worktree does.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const git = async (cwd: string, args: string[]) =>
  (await execFileAsync("git", ["-C", cwd, ...args], { timeout: 10_000 }))
    .stdout;

// The lines that are attribution, as an extended regex for `grep -iE`. The
// same rule as lib/tasks/code-review.ts's ATTRIBUTION for PR bodies; a test
// keeps the two agreeing.
export const ATTRIBUTION_ERE =
  "^[[:space:]]*(co-authored-by:.*(claude|anthropic)|claude-session:|🤖 generated with|[^[:alnum:]\"'`]*generated (with|by) \\[?claude code)";

// The hooks husky installs; a project's own hook of any of these keeps
// running. Not post-index-change or reference-transaction: those run on
// nearly every git command, and husky doesn't wrap them either.
const HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "post-rewrite",
  "pre-auto-gc",
];

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Where the project's own hooks are: the hooksPath it set anywhere but this
// worktree (husky sets `.husky/_`), else the repository's hooks folder.
// A relative hooksPath is relative to the worktree's top, as git reads it.
async function ownHooks(worktree: string): Promise<string> {
  const scoped = await git(worktree, [
    "config",
    "--show-scope",
    "--get-all",
    "core.hooksPath",
  ]).catch(() => "");
  const set = scoped
    .split("\n")
    .map((l) => l.match(/^(\w+)\t(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && m[1] !== "worktree")
    .at(-1)?.[2];
  if (set) {
    const home = set.replace(/^~(?=\/|$)/, os.homedir());
    return path.isAbsolute(home) ? sh(home) : `"$root"/${sh(home)}`;
  }
  const common = (
    await git(worktree, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  ).trim();
  return sh(path.join(common, "hooks"));
}

const delegate = (own: string, hook: string) =>
  `root="$(git rev-parse --show-toplevel)"
own=${own}/${hook}
[ -x "$own" ] && exec "$own" "$@"
exit 0
`;

export function commitMsgHook(own: string): string {
  return `#!/bin/sh
# Installed by AgentOS: removes AI attribution from the commit message, then
# runs the project's own commit-msg hook. Stripped rather than refused: a
# refused commit invites a retry with the same trailer. A UTF-8 locale so a
# non-ASCII letter reads as one, as in the PR body check, even when git runs
# the hook with no locale set; -a so a stray invalid byte can't turn the
# message into a "binary file".
msg="$1"
pattern=${sh(ATTRIBUTION_ERE)}
if LC_ALL=C.UTF-8 grep -qaiE "$pattern" "$msg"; then
  LC_ALL=C.UTF-8 grep -vaiE "$pattern" "$msg" |
    awk 'NF == 0 { blank++; next } { if (seen && blank) print ""; blank = 0; seen = 1; print }' >"$msg.agentos" &&
    mv "$msg.agentos" "$msg"
  echo "AgentOS: removed AI attribution from the commit message; commits here never carry it." >&2
fi
${delegate(own, "commit-msg")}`;
}

/**
 * Point this worktree, and only it, at AgentOS's hooks. Safe to run again.
 * Returns the hooks folder.
 */
export async function installWorktreeHooks(worktree: string): Promise<string> {
  const own = await ownHooks(worktree);
  const gitDir = (
    await git(worktree, ["rev-parse", "--absolute-git-dir"])
  ).trim();
  const dir = path.join(gitDir, "agentos-hooks");
  fs.mkdirSync(dir, { recursive: true });
  for (const hook of HOOKS) {
    const body =
      hook === "commit-msg"
        ? commitMsgHook(own)
        : `#!/bin/sh\n# Installed by AgentOS: runs the project's own ${hook} hook.\n${delegate(own, hook)}`;
    fs.writeFileSync(path.join(dir, hook), body, { mode: 0o755 });
  }
  await git(worktree, ["config", "extensions.worktreeConfig", "true"]);
  await git(worktree, ["config", "--worktree", "core.hooksPath", dir]);
  return dir;
}
