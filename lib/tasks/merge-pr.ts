/**
 * The one `gh pr merge` call: sign-off, done, land and external PRs all
 * merge through it with the configured method. GitHub enforces the
 * repository's allowed methods; when it refuses ours, the error names the
 * method and the repository setting. It never retries with another method.
 */

import { run } from "./gh";
import {
  MERGE_FLAG,
  MERGE_METHODS,
  METHOD_LABEL,
  REPO_SETTING,
  type MergeMethod,
} from "./merge-policy";

export interface MergeRequest {
  repo: string;
  number: number;
  method: MergeMethod;
  // GitHub merges only this commit.
  head?: string;
  // owner/repo, when the PR isn't the checkout's own repository's.
  slug?: string;
}

export interface RepoMergeMethods {
  slug: string;
  allowed: MergeMethod[];
}

const FIELD: Record<MergeMethod, string> = {
  squash: "squashMergeAllowed",
  merge: "mergeCommitAllowed",
  rebase: "rebaseMergeAllowed",
};

// The methods the repository allows; null when GitHub can't say.
export async function repoMergeMethods(
  repo: string,
  slug?: string
): Promise<RepoMergeMethods | null> {
  try {
    const out = await run(
      "gh",
      [
        "repo",
        "view",
        ...(slug ? [slug] : []),
        "--json",
        `nameWithOwner,${Object.values(FIELD).join(",")}`,
      ],
      repo,
      15000
    );
    const data = JSON.parse(out) as Record<string, unknown>;
    return {
      slug: String(data.nameWithOwner ?? slug ?? ""),
      allowed: MERGE_METHODS.filter((m) => data[FIELD[m]] === true),
    };
  } catch {
    return null;
  }
}

export function refusedMethodMessage(
  number: number,
  method: MergeMethod,
  repo: RepoMergeMethods
): string {
  const others = repo.allowed.map((m) => METHOD_LABEL[m]).join(", ");
  return (
    `GitHub refused to merge PR #${number} with the ${METHOD_LABEL[method]} method: ${repo.slug || "the repository"} has "${REPO_SETTING[method]}" turned off (Settings → General → Pull Requests). ` +
    `Nothing was merged, and AgentOS doesn't fall back to another method. ` +
    `Turn that setting on, or set the merge method to one it allows (${others || "none are allowed"}) in AgentOS's Merging settings, the project's settings, or "merge.method" in agentos.json.`
  );
}

const sounds = (text: string) =>
  /merg[\w ]{0,20}(are|is) (not allowed|disabled)|merge method/i.test(text);

export async function mergePR(req: MergeRequest): Promise<void> {
  try {
    await run(
      "gh",
      [
        "pr",
        "merge",
        String(req.number),
        ...(req.slug ? ["--repo", req.slug] : []),
        MERGE_FLAG[req.method],
        ...(req.head ? ["--match-head-commit", req.head] : []),
      ],
      req.repo,
      120000
    );
  } catch (error) {
    // Asked only after a refusal, so a merge costs one call.
    const text = error instanceof Error ? error.message : String(error);
    const methods = await repoMergeMethods(req.repo, req.slug);
    if (methods && !methods.allowed.includes(req.method))
      throw new Error(refusedMethodMessage(req.number, req.method, methods));
    if (!methods && sounds(text))
      throw new Error(
        `GitHub refused to merge PR #${req.number} with the ${METHOD_LABEL[req.method]} method, and the repository's allowed methods couldn't be read. If "${REPO_SETTING[req.method]}" is off in its settings, turn it on or change the merge method. Nothing was merged. GitHub said: ${text.slice(0, 300)}`
      );
    throw error;
  }
}
