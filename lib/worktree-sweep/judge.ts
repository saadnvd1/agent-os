import { describeChanges, unsavedChanges } from "../worktree-placed";
import { unpushedCommits } from "./commits";

export type Verdict = { remove: true } | { remove: false; reason: string };

/**
 * Whether removing the worktree would lose anything: uncommitted changes
 * (except what AgentOS placed and nobody touched), or commits that no remote
 * branch, merged PR or upstream patch holds. Anything that can't be read
 * keeps it.
 */
export async function judgeWorktree(
  path: string,
  repo: string,
  opts: { prHead?: string | null; branch?: string | null } = {}
): Promise<Verdict> {
  const unsaved = await unsavedChanges(path).catch(() => null);
  if (!unsaved)
    return { remove: false, reason: "its changes can't be checked" };
  const stray = await unpushedCommits(path, repo, opts).catch(() => null);
  if (!stray) return { remove: false, reason: "its commits can't be checked" };
  const why = [
    unsaved.length ? `uncommitted changes (${describeChanges(unsaved)})` : null,
    stray.length
      ? `${stray.length} commit${stray.length === 1 ? "" : "s"} no remote branch or merged PR has`
      : null,
  ].filter((w) => w !== null);
  return why.length
    ? { remove: false, reason: why.join(", and ") }
    : { remove: true };
}
