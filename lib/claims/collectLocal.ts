// Turns this machine's live sessions into claims: the repo, branch and the
// paths their diff touches so far. Only paths leave git, never content.

import { getDb } from "../db";
import { getCurrentBranch, getDefaultBranch } from "../git";
import { git } from "../git-exec";
import { repoKey } from "../git-remote";
import { IN_FLIGHT } from "../tasks/queue-rows";
import { expandHome } from "../tasks/session";
import { MAX_FILES } from "./types";
import {
  localLiveSessionIds,
  release,
  upsertLocal,
  type LocalClaim,
} from "./store";

interface SessionRow {
  id: string;
  name: string;
  working_directory: string;
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string | null;
  pr_url: string | null;
  pr_status: string | null;
  task_status: string | null;
}

const OPTS = { timeout: 5000 };

const paths = (out: string) => out.split("\0").filter(Boolean);

export async function changedFiles(
  dir: string,
  base: string
): Promise<string[]> {
  const mergeBase = (
    await git(dir, ["merge-base", "HEAD", `origin/${base}`], OPTS).catch(() =>
      git(dir, ["merge-base", "HEAD", base], OPTS).catch(() => "")
    )
  ).trim();
  const [committed, untracked] = await Promise.all([
    mergeBase
      ? git(dir, ["diff", "--name-only", "-z", mergeBase], OPTS)
      : git(dir, ["diff", "--name-only", "-z", "HEAD"], OPTS).catch(() => ""),
    git(dir, ["ls-files", "--others", "--exclude-standard", "-z"], OPTS),
  ]);
  return [...new Set([...paths(committed), ...paths(untracked)])];
}

// Sessions that can hold a claim: local, not a mirror of another machine's.
function candidates(): SessionRow[] {
  return getDb()
    .prepare(
      `SELECT id, name, working_directory, worktree_path, branch_name, base_branch,
              pr_url, pr_status, task_status
         FROM session_rows
        WHERE archived_at IS NULL AND COALESCE(peer_mirror, 0) = 0
          AND (host_id IS NULL OR host_id = 'local')`
    )
    .all() as SessionRow[];
}

const last = new Map<string, LocalClaim>();

// Writes this machine's claims and releases the ones whose session is gone,
// finished, or whose PR closed. A git failure keeps the last good paths.
export async function collectLocal(origin: {
  id: string;
  name: string;
}): Promise<void> {
  const alive = new Set<string>();
  for (const s of candidates()) {
    try {
      const done = s.pr_status === "merged" || s.pr_status === "closed";
      const idleTask =
        s.task_status &&
        !IN_FLIGHT.includes(s.task_status) &&
        s.pr_status !== "open";
      if (done || idleTask) {
        if (done) release(s.id, s.pr_status === "merged" ? "merged" : "done");
        continue;
      }
      const dir = expandHome(s.worktree_path || s.working_directory);
      const repo = await repoKey(dir);
      if (!repo) continue;
      const branch = s.branch_name || (await getCurrentBranch(dir));
      const base = s.base_branch || (await getDefaultBranch(dir));
      let files: string[];
      try {
        files = await changedFiles(dir, base);
      } catch {
        files = last.get(s.id)?.files ?? [];
      }
      // A shell sitting on the default branch with no changes claims nothing.
      if ((branch === base || branch === "HEAD") && !files.length) continue;
      const claim: LocalClaim = {
        sessionId: s.id,
        sessionName: s.name,
        repo,
        branch,
        base,
        goal: s.name,
        files: files.slice(0, MAX_FILES),
        filesMore: Math.max(0, files.length - MAX_FILES),
        prUrl: s.pr_url,
      };
      last.set(s.id, claim);
      upsertLocal(origin, claim);
      alive.add(s.id);
    } catch {
      // This session claims nothing this round.
    }
  }
  for (const id of localLiveSessionIds())
    if (!alive.has(id)) {
      release(id, "abandoned");
      last.delete(id);
    }
}
