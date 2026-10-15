// The worktrees of an orchestrator's open quick changes, which its write
// guard lets it edit (quick.ts). Only running ones: a finished or dropped
// quick change's folder is gone, or about to be.

import { db } from "../db";
import { expandHome } from "../tasks/session";

export function quickWorktrees(orchestratorId: string): string[] {
  return (
    db
      .prepare(
        `SELECT worktree_path AS dir FROM session_rows
          WHERE quick_of = ? AND task_status = 'running'
            AND worktree_path IS NOT NULL AND worktree_path != ''`
      )
      .all(orchestratorId) as { dir: string }[]
  ).map((r) => expandHome(r.dir));
}
