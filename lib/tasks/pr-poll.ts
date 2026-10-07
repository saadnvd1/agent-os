// Task PRs, found with one `gh pr list` of a repository's open PRs a minute
// instead of a query per branch per poll. A branch with no open PR (none
// yet, merged, closed) is asked about on its own at most every 5 minutes.
// fresh skips both caches, for a merge or a sign-off.

import { findPR, findPRStrict, run, toTaskPR, type ListedPR } from "./gh";
import type { TaskPR } from "./state";

export const OPEN_TTL_MS = 60_000;
export const BRANCH_TTL_MS = 5 * 60_000;
const OPEN_FIELDS =
  "number,url,state,headRefOid,statusCheckRollup,body,headRefName,isCrossRepository,createdAt";

interface OpenList {
  at: number;
  prs: ListedPR[];
  // Each listed PR as a TaskPR, worked out once per list.
  views: Map<number, Promise<TaskPR>>;
}

const openLists = new Map<string, OpenList>();
const inflight = new Map<string, Promise<OpenList>>();
const branchLookups = new Map<
  string,
  { at: number; ttl: number; pr: Promise<TaskPR | null> }
>();

// The repository's open PRs; callers at the same time share one request.
async function openList(repoDir: string, now: number): Promise<OpenList> {
  const cached = openLists.get(repoDir);
  if (cached && now - cached.at < OPEN_TTL_MS) return cached;
  let pending = inflight.get(repoDir);
  if (!pending) {
    pending = run(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        OPEN_FIELDS,
      ],
      repoDir,
      30000
    )
      .then((out) => {
        const list = {
          at: Date.now(),
          prs: JSON.parse(out) as ListedPR[],
          views: new Map(),
        };
        openLists.set(repoDir, list);
        return list;
      })
      .finally(() => inflight.delete(repoDir));
    inflight.set(repoDir, pending);
  }
  return pending;
}

export interface LookupOpts {
  fresh?: boolean;
  // A gh failure throws instead of reading as "no PR".
  strict?: boolean;
  // Only a PR opened at or after this time (ISO).
  since?: string;
}

const matches = (pr: ListedPR, branch: string, since?: string) =>
  pr.headRefName === branch &&
  !pr.isCrossRepository &&
  (!since || Date.parse(pr.createdAt ?? "") >= Date.parse(since));

export async function lookupPR(
  repoDir: string,
  branch: string,
  opts: LookupOpts = {}
): Promise<TaskPR | null> {
  const { since } = opts;
  if (opts.fresh)
    return (opts.strict ? findPRStrict : findPR)(repoDir, branch, { since });
  const now = Date.now();
  // A lookup filtered by another task's start isn't this one's answer.
  const key = `${repoDir}\0${branch}\0${since ?? ""}`;
  try {
    const list = await openList(repoDir, now);
    const hit = list.prs.find((p) => matches(p, branch, since));
    if (hit) {
      let view = list.views.get(hit.number);
      if (!view) {
        view = toTaskPR(repoDir, hit);
        list.views.set(hit.number, view);
        view.catch(() => list.views.delete(hit.number));
      }
      return await view;
    }
    const last = branchLookups.get(key);
    if (last && now - last.at < last.ttl) return await last.pr;
    // Shared by callers at the same time; a failure isn't kept.
    const entry = {
      at: now,
      ttl: BRANCH_TTL_MS,
      pr: findPRStrict(repoDir, branch, { since }),
    };
    branchLookups.set(key, entry);
    entry.pr.then(
      // Opened since the list was read: the next list will have it.
      (pr) => pr?.state === "OPEN" && (entry.ttl = OPEN_TTL_MS),
      () => branchLookups.get(key) === entry && branchLookups.delete(key)
    );
    return await entry.pr;
  } catch (error) {
    if (opts.strict) throw error;
    return null;
  }
}

// Tests only.
export function resetPRPoll(): void {
  openLists.clear();
  inflight.clear();
  branchLookups.clear();
}
