/**
 * Finishing or undoing a move that stopped partway. A task left "moving"
 * here has a stopped agent and can't be signed off; it either arrived on the
 * other machine (then it's moved, and mirrored here) or it didn't (then it
 * resumes here). Resuming without asking is for when the other machine is
 * gone for good, and is the user's call.
 */

import { db, type Session } from "../db";
import { hostIdNamed } from "../hosts";
import { hostApi, hostLink, type HostLink } from "../hosts/remote-api";
import { getTaskSession } from "./session";
import { markMoved, resumeTask } from "./move";
import { forgetHostTasks, mirrorTask, unknownOutcome } from "./remote";

/** POST, repeated when the outcome is unknown (the calls are idempotent). */
export async function tell(
  link: HostLink,
  path: string,
  body: object = {}
): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await hostApi(link, path, { body });
      return;
    } catch (err) {
      if (!unknownOutcome(err) || i === 2) throw err;
    }
  }
}

/** The task a move from this session made there, or null. Throws if unsure. */
export async function arrivedThere(
  link: HostLink,
  sessionId: string
): Promise<Session | null> {
  const { session } = await hostApi<{ session: Session | null }>(
    link,
    `/api/tasks/arrived?from=${encodeURIComponent(sessionId)}`
  );
  return session;
}

export function settleMovedOut(
  session: Session,
  hostId: string,
  hostName: string,
  there: Session
): Session {
  db.transaction(() => {
    markMoved(session.id, hostName);
    mirrorTask(hostId, session.project_id, there);
  })();
  forgetHostTasks(hostId);
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(there.id) as Session;
}

/**
 * "Resume here" on a task left moving. It asks the machine it was moving to
 * first; force skips that, for a machine that's gone.
 */
export async function resumeHere(
  id: string,
  force = false
): Promise<{ resumed: boolean; movedTo?: string }> {
  const session = getTaskSession(id);
  if (session.task_status !== "moving" || force) {
    await resumeTask(id);
    return { resumed: true };
  }
  const name = session.moved_to ?? "";
  let hostId: string | null = null;
  try {
    hostId = hostIdNamed(name);
  } catch {
    hostId = null;
  }
  const link = hostId ? hostLink(hostId) : null;
  if (!link || !hostId)
    throw new Error(
      `Can't ask ${name || "the other machine"} whether it arrived there. Resume anyway only if it didn't.`
    );
  const there = await arrivedThere(link, id).catch((err) => {
    throw new Error(
      `Can't ask ${link.hostName} whether it arrived there (${(err as Error).message}). Resume anyway only if it didn't.`
    );
  });
  if (there) {
    settleMovedOut(session, hostId, link.hostName, there);
    return { resumed: false, movedTo: link.hostName };
  }
  await resumeTask(
    id,
    `The move to ${link.hostName} didn't go through. Carry on here.`
  );
  return { resumed: true };
}
