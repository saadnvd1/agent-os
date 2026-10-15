// Deleting a task's own branch on GitHub once its PR is merged or closed.
// Never throws: a branch that stays is a logged line, not a failed merge.

import { git, gitPush } from "../git-exec";
import { repoSlug } from "../git-remote";
import { run } from "./gh";

// Never deleted, whatever a setting says.
export const PROTECTED_BRANCHES = new Set(["main", "master", "HEAD"]);

export interface BranchDelete {
  deleted: boolean;
  why: string;
}

export interface DeleteBranchOpts {
  repo: string;
  branch: string;
  // The head the PR merged or closed at; the branch goes only if it is still
  // exactly this commit.
  prHead: string | null | undefined;
  // owner/repo, when known; read from the checkout's origin otherwise.
  slug?: string | null;
  // Another open PR in the repo builds on this branch (decided by the caller
  // when it knows from its own records; GitHub is asked too).
  hasChildren?: boolean;
  // Branches this one must never be (the default and base branches).
  keep?: (string | null | undefined)[];
}

const gone = (error: unknown) =>
  /HTTP (404|422)|Not Found|Reference does not exist/i.test(
    error instanceof Error ? error.message : String(error)
  );

// repos/o/r/git/ref(s)/heads/<branch>, each path segment encoded.
export const refPath = (slug: string, branch: string, plural: boolean) =>
  `repos/${slug}/git/${plural ? "refs" : "ref"}/heads/${branch
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

// The branch's commit on GitHub; null when it is gone.
export async function remoteTip(
  repo: string,
  slug: string,
  branch: string
): Promise<string | null> {
  try {
    const out = await run(
      "gh",
      ["api", refPath(slug, branch, false), "--jq", ".object.sha"],
      repo,
      20000
    );
    return out.trim() || null;
  } catch (error) {
    if (gone(error)) return null;
    throw error;
  }
}

// Open PRs targeting the branch: a stacked child, which GitHub would close
// (and could no longer retarget) if its base vanished.
export async function openChildren(
  repo: string,
  slug: string,
  branch: string
): Promise<number[]> {
  const out = await run(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      slug,
      "--base",
      branch,
      "--state",
      "open",
      "--json",
      "number",
    ],
    repo,
    20000
  );
  return (JSON.parse(out) as { number: number }[]).map((p) => p.number);
}

async function decide(o: DeleteBranchOpts): Promise<BranchDelete> {
  const { repo, branch, prHead } = o;
  if (PROTECTED_BRANCHES.has(branch))
    return { deleted: false, why: "a protected branch" };
  if (o.keep?.includes(branch))
    return { deleted: false, why: "it is a base branch" };
  if (!prHead) return { deleted: false, why: "no PR head was recorded" };
  if (o.hasChildren)
    return { deleted: false, why: "stacked cards still build on it" };
  const slug = o.slug ?? (await repoSlug(repo));
  if (!slug) return deleteViaGit(repo, branch, prHead);

  const kids = await openChildren(repo, slug, branch);
  if (kids.length)
    return {
      deleted: false,
      why: `open PR ${kids.map((n) => `#${n}`).join(", ")} is based on it`,
    };
  const tip = await remoteTip(repo, slug, branch);
  if (!tip) return { deleted: false, why: "already gone" };
  if (tip !== prHead)
    return {
      deleted: false,
      why: `it moved to ${tip.slice(0, 7)} after the PR's ${prHead.slice(0, 7)}`,
    };
  try {
    await run(
      "gh",
      ["api", "-X", "DELETE", refPath(slug, branch, true)],
      repo,
      30000
    );
  } catch (error) {
    if (!gone(error)) throw error;
  }
  return { deleted: true, why: "deleted" };
}

// A checkout whose origin isn't on GitHub: ask and delete through git.
async function deleteViaGit(
  repo: string,
  branch: string,
  prHead: string
): Promise<BranchDelete> {
  const line = await git(
    repo,
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    { timeout: 30000 }
  );
  const tip = line.trim().split(/\s+/)[0];
  if (!tip) return { deleted: false, why: "already gone" };
  if (tip !== prHead)
    return {
      deleted: false,
      why: `it moved to ${tip.slice(0, 7)} after the PR's ${prHead.slice(0, 7)}`,
    };
  await gitPush(repo, ["origin", "--delete", branch], { timeout: 60000 });
  return { deleted: true, why: "deleted" };
}

export async function deleteTaskBranch(
  o: DeleteBranchOpts
): Promise<BranchDelete> {
  let result: BranchDelete;
  try {
    result = await decide(o);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    result = {
      deleted: false,
      why: `couldn't delete it: ${text.split("\n")[0].slice(0, 200)}`,
    };
  }
  if (!result.deleted)
    console.log(`[tasks] kept origin/${o.branch}: ${result.why}`);
  return result;
}
