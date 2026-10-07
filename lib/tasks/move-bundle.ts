/**
 * What a moving task carries between machines, and the checks the arriving
 * side runs on it before anything touches git or the disk.
 */

import { isBranchName } from "../git";
import type { ProjectRef } from "./project-ref";
import { isClaudeSessionId } from "./transcript";

// A long task's conversation runs to a few MB; this is far past that.
export const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = MAX_TRANSCRIPT_BYTES + 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isSessionId = (id: unknown): id is string =>
  typeof id === "string" && UUID.test(id);

/**
 * Another request is doing this right now. Not a refusal: the caller can't
 * tell yet whether it will land, so routes answer 503 for it.
 */
export class InProgressError extends Error {}

export const statusFor = (err: unknown, refused = 400) =>
  err instanceof InProgressError ? 503 : refused;

export interface TaskBundle {
  // The source session's id: importing the same move twice finds the first.
  moveId: string;
  name: string;
  prompt: string;
  model: string;
  branch: string;
  baseBranch: string | null;
  project: ProjectRef;
  // The machine it's leaving, for the note the agent reads on arrival.
  from: string;
  claude: {
    sessionId: string;
    cwd: string;
    home: string;
    transcript: string;
  } | null;
}

export function validateBundle(b: TaskBundle): TaskBundle {
  if (!b || typeof b !== "object") throw new Error("No task to import");
  if (!isSessionId(b.moveId)) throw new Error("Bad move id");
  if (typeof b.branch !== "string" || !isBranchName(b.branch))
    throw new Error("Bad branch name");
  if (
    b.baseBranch !== null &&
    (typeof b.baseBranch !== "string" || !isBranchName(b.baseBranch))
  )
    throw new Error("Bad base branch name");
  if (
    typeof b.name !== "string" ||
    typeof b.prompt !== "string" ||
    typeof b.model !== "string"
  )
    throw new Error("Bad task");
  if (!b.project || typeof b.project.path !== "string")
    throw new Error("Bad project");
  if (b.claude) {
    const c = b.claude;
    if (!isClaudeSessionId(c.sessionId))
      throw new Error("Bad Claude session id");
    if ([c.cwd, c.home, c.transcript].some((v) => typeof v !== "string"))
      throw new Error("Bad conversation");
    if (c.transcript.length > MAX_TRANSCRIPT_BYTES)
      throw new Error("The conversation is too large to move");
  }
  return {
    ...b,
    name: b.name.slice(0, 200),
    from: String(b.from || "another machine")
      .replace(/[^\w.@ -]/g, "")
      .slice(0, 100),
  };
}

export function arrivalNote(
  b: { from: string; branch: string },
  cwd: string
): string {
  return [
    `This task just moved here from ${b.from}. Your worktree is now ${cwd}, on branch ${b.branch}.`,
    `Anything that was uncommitted came over as a commit starting "wip: moving to"; fold it into your own commits as you see fit.`,
    `Continue the task where you left off.`,
  ].join(" ");
}
