// A winner of an overlap merged: the base moved under the session that gave
// way. One with a PR is left to rebaseConflicting once GitHub flags a
// conflict. One without gets a single message, and a refreshBase when it is
// idle with nothing uncommitted (refreshBase never loses work). Nothing here
// pauses or stops a session.

import { getDb } from "../db";
import { git } from "../git-exec";
import { statusOf } from "../orchestrator/facts";
import { getSessionRow } from "../schedules/store";
import { refreshBase, type RefreshTarget } from "../tasks/refresh-base";
import { expandHome } from "../tasks/session";
import { machineId } from "./machine";
import { mergedMessage } from "./overlapText";
import { claimById } from "./store";
import { tellSession, type Tell } from "./notifyOverlaps";
import { winner } from "./yield";

export interface MergedDeps {
  tell: Tell;
  idle: (sessionId: string) => Promise<boolean>;
  clean: (dir: string) => Promise<boolean>;
  refresh: (t: RefreshTarget) => Promise<unknown>;
}

export const realMerged: MergedDeps = {
  tell: tellSession,
  idle: async (id) => {
    const s = getSessionRow(id);
    return !!s && (await statusOf(s)).status === "idle";
  },
  clean: async (dir) =>
    !(await git(dir, ["status", "--porcelain"], { timeout: 5000 })).trim(),
  refresh: refreshBase,
};

interface Row {
  pair_key: string;
}

export async function handleMerged(
  deps: MergedDeps = realMerged,
  now = Date.now()
): Promise<number> {
  const db = getDb();
  const self = machineId();
  const rows = db
    .prepare(
      `SELECT pair_key FROM claim_notices WHERE told_at IS NOT NULL AND merged_at IS NULL`
    )
    .all() as Row[];
  const done = db.prepare(
    `UPDATE claim_notices SET merged_at = ? WHERE pair_key = ?`
  );
  let handled = 0;
  for (const { pair_key } of rows) {
    const [a, b] = pair_key.split("|").map((id) => claimById(id));
    if (!a || !b) continue;
    const gone = [a, b].find((c) => c.released === "merged");
    const mine = [a, b].find(
      (c) => !c.released && c.origin === self && c.sessionId
    );
    if (!gone || !mine || winner(gone, mine) !== gone) continue;
    try {
      const s = getSessionRow(mine.sessionId!);
      // A session with a PR is the rebase pipeline's.
      if (s && !s.pr_url && s.pr_status !== "open") {
        await deps.tell(s.id, mergedMessage(gone, s.base_branch ?? mine.base));
        const dir = s.worktree_path ? expandHome(s.worktree_path) : null;
        if (dir && (await deps.idle(s.id)) && (await deps.clean(dir)))
          await deps.refresh({
            name: s.name,
            worktree: dir,
            branch: s.branch_name,
            base: s.base_branch,
          });
        handled++;
      }
      done.run(now, pair_key);
    } catch {
      // Tried again next sync.
    }
  }
  return handled;
}
