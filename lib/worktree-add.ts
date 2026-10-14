/**
 * The one place AgentOS runs `git worktree add`. git-crypt looks for its key
 * under the worktree's own git dir, so in a repo that uses it a plain add
 * dies in the smudge filter. There the worktree is made without a checkout,
 * the main repo's git-crypt dir is symlinked in (one copy of the key, so a
 * re-lock or revoke applies everywhere; `git worktree remove` unlinks it and
 * leaves the target), and the files are checked out after. The key is never
 * read, copied or printed.
 */

import fs from "fs";
import path from "path";

export type AddRunner = (args: string[], cwd: string) => Promise<string>;

export class GitCryptLockedError extends Error {
  constructor(repo: string) {
    super(`${path.basename(repo)} is git-crypt locked; unlock it first`);
    this.name = "GitCryptLockedError";
  }
}

/** The repo's git-crypt dir when it uses git-crypt, else null. */
async function cryptDir(run: AddRunner, repo: string): Promise<string | null> {
  const common = (await run(["rev-parse", "--git-common-dir"], repo)).trim();
  const dir = path.join(path.resolve(repo, common), "git-crypt");
  return fs.existsSync(dir) ? dir : null;
}

// `git-crypt lock` removes the keys; an unlocked repo has one per key name.
const isUnlocked = (dir: string) => {
  try {
    return fs.readdirSync(path.join(dir, "keys")).length > 0;
  } catch {
    return false;
  }
};

/**
 * `git worktree add <addArgs…> <dir> <ref>`; `addArgs` is the flags in front
 * of the path (`["-b", branch]`, `["--detach"]`).
 */
export async function addWorktree(
  run: AddRunner,
  repo: string,
  dir: string,
  ref: string,
  addArgs: string[] = []
): Promise<void> {
  const crypt = await cryptDir(run, repo);
  if (!crypt) {
    await run(["worktree", "add", ...addArgs, "--", dir, ref], repo);
    return;
  }
  if (!isUnlocked(crypt)) throw new GitCryptLockedError(repo);
  await run(
    ["worktree", "add", "--no-checkout", ...addArgs, "--", dir, ref],
    repo
  );
  try {
    const gitDir = (await run(["rev-parse", "--absolute-git-dir"], dir)).trim();
    const link = path.join(gitDir, "git-crypt");
    fs.rmSync(link, { force: true });
    fs.symlinkSync(crypt, link, "dir");
    await run(["reset", "--hard", "-q"], dir);
  } catch (error) {
    await run(["worktree", "remove", "-f", "-f", "--", dir], repo).catch(
      () => ""
    );
    throw error;
  }
}

/** Whether a worktree was given the repo's git-crypt key (see addWorktree). */
export function usesGitCrypt(worktree: string): boolean {
  try {
    const dotGit = path.join(worktree, ".git");
    const gitDir = fs.statSync(dotGit).isDirectory()
      ? dotGit
      : path.resolve(
          worktree,
          fs
            .readFileSync(dotGit, "utf8")
            .replace(/^gitdir:\s*/, "")
            .trim()
        );
    return fs.existsSync(path.join(gitDir, "git-crypt"));
  } catch {
    return false;
  }
}
