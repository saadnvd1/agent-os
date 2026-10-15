import { getDefaultBranch } from "../git";
import { git as runGit } from "../git-exec";

const git = (cwd: string, ...args: string[]) =>
  runGit(cwd, args, { timeout: 60_000 }).then((out) => out.trim());

const lines = (out: string) => out.split("\n").filter(Boolean);

/**
 * Commits on the worktree's HEAD that nothing else holds: not on any remote
 * branch, not in the PR a merge took, and with no patch-equivalent commit on
 * the base or its own remote branch (a rewritten history re-lands the same
 * changes under new hashes). The shas, so a caller can count and name them.
 */
export async function unpushedCommits(
  worktree: string,
  repo: string,
  opts: { prHead?: string | null; branch?: string | null } = {}
): Promise<string[]> {
  const head =
    opts.prHead &&
    (await git(
      worktree,
      "rev-parse",
      "--verify",
      "--quiet",
      `${opts.prHead}^{commit}`
    )
      .then(() => [opts.prHead!])
      .catch(() => []));
  const stray = lines(
    await git(
      worktree,
      "rev-list",
      "HEAD",
      "--not",
      ...(head || []),
      "--remotes"
    )
  );
  if (!stray.length) return [];
  const base = await getDefaultBranch(repo).catch(() => "main");
  const upstreams: string[] = [];
  for (const ref of [
    `origin/${base}`,
    opts.branch && `origin/${opts.branch}`,
  ]) {
    if (
      ref &&
      (await git(worktree, "rev-parse", "--verify", "--quiet", ref)
        .then(() => true)
        .catch(() => false))
    )
      upstreams.push(ref);
  }
  const left = new Set(stray);
  for (const ref of upstreams) {
    if (!left.size) break;
    // "- <sha>" is a commit the upstream already has the same patch for.
    const cherry = lines(await git(worktree, "cherry", ref, "HEAD"));
    for (const l of cherry)
      if (l.startsWith("- ")) left.delete(l.slice(2).trim());
  }
  return [...left];
}
