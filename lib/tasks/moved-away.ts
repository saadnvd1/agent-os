/**
 * What a machine tidies up after a task it held went back to the machine
 * that sent it: its agent and chat worker stop, its ports are released, and
 * its worktree goes when nothing in it would be lost (no uncommitted change,
 * no commit a remote lacks). The row stays, archived, as history.
 */

import { releaseSessionLeftovers } from "../sessions/leftovers";
import { db, type Session } from "../db";
import { endSessionAgent } from "../sessions/end";
import { releasePorts } from "../ports";
import { settleWorktree, type WorktreeFate } from "../done/worktree";
import { archiveSession } from "../done/archive";

export async function cleanUpMovedAway(id: string): Promise<WorktreeFate> {
  const s = db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;
  if (!s || s.task_status !== "moved" || !s.held_by_device)
    return { action: "none" };
  await endSessionAgent(s).catch((err) =>
    console.error(`[moved-away] ${id}: agent not stopped:`, err)
  );
  releasePorts(id);
  const fate = await settleWorktree(s, null, true).catch(
    (err): WorktreeFate => ({
      action: "kept",
      why: `it couldn't be checked: ${err instanceof Error ? err.message : err}`,
      path: s.worktree_path ?? "",
    })
  );
  void releaseSessionLeftovers(s);
  archiveSession(id);
  if (fate.action === "kept")
    console.warn(
      `[moved-away] ${id}: worktree kept at ${fate.path}: ${fate.why}`
    );
  return fate;
}
