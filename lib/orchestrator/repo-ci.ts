/**
 * Whether a repository has CI at all, decided from the repository and never
 * from one head: workflow files on the base, else any check or status that
 * ever ran on the default branch or the recent PRs. A head with no checks in
 * a repository that has CI is not yet (its PR conflicts, or CI hasn't been
 * triggered); only a repository without CI is one with nothing to gate on.
 */

import { getDefaultBranch } from "../git";
import { git } from "../git-exec";
import { run } from "../tasks/gh";
import { repoSlug } from "./repo-slug";

export type RepoCI = "yes" | "no" | "unknown";

const YES_TTL_MS = 60 * 60 * 1000;
const NO_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; ci: "yes" | "no" }>();

export function clearRepoCI(): void {
  cache.clear();
}

export interface RepoCIDeps {
  // The files under .github/workflows on `ref`.
  workflows: (repo: string, ref: string) => Promise<string[]>;
  // How many checks or statuses ran on the default branch and the recent
  // PRs; null when GitHub can't say.
  history: (repo: string) => Promise<number | null>;
  now: () => number;
}

const count = (out: string) => {
  const n = Number(out.trim());
  return out.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};

export const repoCIDeps: RepoCIDeps = {
  workflows: async (repo, ref) =>
    (
      await git(repo, ["ls-tree", "--name-only", ref, ".github/workflows/"], {
        timeout: 10000,
      })
    )
      .split("\n")
      .filter((f) => /\.ya?ml$/i.test(f.trim())),
  history: async (repo) => {
    const slug = await repoSlug(repo);
    if (!slug) return null;
    const branch = await getDefaultBranch(repo);
    const ask = (args: string[]) =>
      run("gh", args, repo, 20000).then(count, () => null);
    const counts = await Promise.all([
      ask([
        "api",
        `repos/${slug}/commits/${branch}/check-runs?per_page=1`,
        "--jq",
        ".total_count",
      ]),
      ask([
        "api",
        `repos/${slug}/commits/${branch}/status`,
        "--jq",
        ".statuses | length",
      ]),
      ask([
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        "20",
        "--json",
        "statusCheckRollup",
        "--jq",
        "[.[] | (.statusCheckRollup // []) | length] | add // 0",
      ]),
    ]);
    if (counts.some((c) => c !== null && c > 0)) return 1;
    return counts.every((c) => c === 0) ? 0 : null;
  },
  now: Date.now,
};

// "unknown" when it can't be told (GitHub unreachable or backed off): the
// ci gate waits on that, it never escalates or passes on a guess.
export async function repoHasCI(
  repo: string,
  baseRef: string,
  deps: RepoCIDeps = repoCIDeps
): Promise<RepoCI> {
  const hit = cache.get(repo);
  if (hit && deps.now() - hit.at < (hit.ci === "yes" ? YES_TTL_MS : NO_TTL_MS))
    return hit.ci;
  const found = (ci: "yes" | "no") => {
    cache.set(repo, { at: deps.now(), ci });
    return ci;
  };
  if ((await deps.workflows(repo, baseRef).catch(() => [])).length)
    return found("yes");
  const seen = await deps.history(repo).catch(() => null);
  if (seen === null) return "unknown";
  return found(seen > 0 ? "yes" : "no");
}
