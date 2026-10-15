/**
 * A session whose worktree the age clean-up removed: bringing it back
 * recreates the worktree from its branch, or says plainly that it's gone.
 */

import fs from "fs";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { expandHome, projectPathFor } from "../tasks/session";
import { forgetSwept, sweptAt } from "../worktree-sweep/store";
import { restoreWorktree } from "./snapshot";

const day = (t: string) => t.slice(0, 10);

// "its worktree was cleaned up on 2026-10-15" for a session the sweep removed
// the worktree of; null for any other.
export function sweptNote(id: string): string | null {
  const at = sweptAt(id);
  return at ? `its worktree was cleaned up on ${day(at)}` : null;
}

/**
 * For a session coming back without a task restore (unarchive, reopen):
 * rebuild a swept worktree. The note says what happened; null when the
 * session wasn't swept or its worktree is still there.
 */
export async function restoreSwept(s: Session): Promise<string | null> {
  const note = sweptNote(s.id);
  if (!note || !s.worktree_path) return null;
  const old = expandHome(s.worktree_path);
  if (fs.existsSync(old)) {
    forgetSwept(s.id);
    return null;
  }
  const project = s.project_id ? getProject(s.project_id) : null;
  const repo = project ? projectPathFor(s) : null;
  const restored =
    repo && s.branch_name && fs.existsSync(repo)
      ? await restoreWorktree({
          sessionId: s.id,
          repo,
          branch: s.branch_name,
          base: s.base_branch,
          oldPath: old,
          allowFresh: false,
        }).catch(() => null)
      : null;
  if (restored) {
    db.prepare(
      `UPDATE sessions SET worktree_path = ?, working_directory = ? WHERE id = ?`
    ).run(restored.path, restored.path, s.id);
    forgetSwept(s.id);
    return `${note} and recreated from ${s.branch_name}`;
  }
  // No branch to build from: the conversation alone, in the project folder.
  db.prepare(
    `UPDATE sessions SET worktree_path = NULL, working_directory = ? WHERE id = ?`
  ).run(repo ?? s.working_directory, s.id);
  forgetSwept(s.id);
  return `${note} and its branch is gone, so only the conversation came back`;
}
