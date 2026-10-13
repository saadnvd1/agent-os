/**
 * Move a task between this machine and a linked one. Every call it makes to
 * the other machine is safe to repeat (keyed by the source session), so a
 * move that can't tell whether it landed stays "moving" and Move again
 * finishes it. The agent resumes at the source only when the target said no.
 */

import os from "os";
import { db, type Session } from "../db";
import { isRemoteHost } from "../hosts";
import { requireHostLink, type HostLink } from "../hosts/remote-api";
import { getTaskSession } from "./session";
import { exportOrResume, resumeTask, type TaskBundle } from "./move";
import { isOrchestrated, moveRefusal } from "./move-guard";
import { holderRefusal } from "./held";
import { isPaused } from "../orchestrator/pause";
import { sessionWorkspace } from "../models/resolve";
import { arrived as arrivedHere, importTask } from "./import";
import {
  forgetHostTasks,
  hostTasks,
  postIdempotent,
  unknownOutcome,
} from "./remote";
import { arrivedThere, settleMovedOut, tell } from "./move-recover";
import {
  finishProgress,
  moveSteps,
  startProgress,
  stepProgress,
} from "./move-progress";

const LIVE = new Set(["running", "moving"]);

// Moves this process is running, so a second press can't reset the first's
// progress or report its own refusal as the first one failing.
const g = globalThis as unknown as { __agentosMovesInFlight?: Set<string> };
const inFlight = (g.__agentosMovesInFlight ??= new Set());

/** Why this task can't move to that machine now, as an error; or nothing. */
export function assertMovable(id: string, toHostId: string): Session {
  const session = getTaskSession(id);
  if (!LIVE.has(session.task_status ?? ""))
    throw new Error(`Task is already ${session.task_status}`);
  const fromRemote = isRemoteHost(session.host_id);
  const toRemote = isRemoteHost(toHostId);
  if (fromRemote === toRemote) {
    throw new Error(
      fromRemote
        ? "Move it to this machine first"
        : "It's already on this machine"
    );
  }
  // A person here can't move what another machine's orchestrator holds.
  const held = holderRefusal(session, null);
  if (held) throw new Error(held);
  const refusal = moveRefusal(session);
  if (refusal) throw new Error(refusal);
  // Pause stops the orchestrator's new work, and a move is some.
  const workspace = sessionWorkspace(session);
  if (workspace && isOrchestrated(session) && isPaused(workspace))
    throw new Error("The orchestrator is paused; moves wait for Resume");
  if (inFlight.has(id)) throw new Error("It's already moving");
  return session;
}

export async function moveTask(id: string, toHostId: string): Promise<Session> {
  const session = assertMovable(id, toHostId);
  const toRemote = isRemoteHost(toHostId);
  inFlight.add(id);
  try {
    const moved = toRemote
      ? await moveOut(session, toHostId)
      : await moveIn(session);
    finishProgress(id);
    return moved;
  } catch (err) {
    finishProgress(id, err);
    throw err;
  } finally {
    inFlight.delete(id);
  }
}

// A machine on an older AgentOS would take a chat task as a terminal one,
// or an orchestrator's task as a plain one that anyone there could merge, or
// refuse to hand one over.
async function requireCapability(
  link: HostLink,
  capability: string,
  what: string
): Promise<void> {
  const { capabilities = [] } = await hostTasks(link, true).catch((err) => {
    throw new Error(
      `Can't ask ${link.hostName} whether it takes ${what}: ${(err as Error).message}`
    );
  });
  if (!capabilities.includes(capability))
    throw new Error(
      `${link.hostName}'s AgentOS can't move ${what} yet; update it first`
    );
}

const requireChatMoves = (link: HostLink) =>
  requireCapability(link, "chat-move", "chat tasks");

const unconfirmed = (where: string, err: unknown) =>
  new Error(
    `Couldn't confirm the move with ${where} (${(err as Error).message}). It's paused as "moving": press Move again to finish it.`
  );

async function moveOut(session: Session, hostId: string): Promise<Session> {
  const link = requireHostLink(hostId);
  const chat = session.view === "chat";
  if (chat) await requireChatMoves(link);
  if (isOrchestrated(session))
    await requireCapability(link, "orchestrated-move", "orchestrator tasks");
  startProgress(
    session.id,
    link.hostName,
    moveSteps("out", link.hostName, chat)
  );
  // A retry: if an earlier try arrived, it runs there now.
  if (session.task_status === "moving") {
    const there = await arrivedThere(link, session.id).catch((err) => {
      throw unconfirmed(link.hostName, err);
    });
    if (there) return settleMovedOut(session, hostId, link.hostName, there);
  }
  const bundle = await exportOrResume(session.id, link.hostName);
  stepProgress(session.id, "arrive");
  let there: Session;
  try {
    ({ session: there } = await postIdempotent<{ session: Session }>(
      link,
      "/api/tasks/import",
      bundle,
      600000
    ));
  } catch (err) {
    // It may be running there already: resuming here could run it twice.
    if (unknownOutcome(err)) throw unconfirmed(link.hostName, err);
    await resumeTask(session.id);
    throw err;
  }
  return settleMovedOut(session, hostId, link.hostName, there);
}

function mirrorRunning(id: string): void {
  db.prepare(
    `UPDATE sessions SET task_status = 'running', moved_to = NULL
       WHERE id = ? AND task_status = 'moving'`
  ).run(id);
}

async function moveIn(mirror: Session): Promise<Session> {
  const link = requireHostLink(mirror.host_id);
  if (mirror.view === "chat") await requireChatMoves(link);
  startProgress(mirror.id, "this machine", moveSteps("in", link.hostName));
  const path = `/api/tasks/${encodeURIComponent(mirror.id)}`;
  // A retry after it arrived here but that machine didn't hear: tidy up.
  let here = arrivedHere(mirror.id);
  if (!here) {
    // Moving, so nothing reads the mirror as a task to judge, or sign off,
    // while it leaves (a refusal below puts it back).
    db.prepare(
      `UPDATE sessions SET task_status = 'moving', moved_to = 'this machine'
         WHERE id = ? AND task_status = 'running'`
    ).run(mirror.id);
    // That machine resumes the agent itself if its half fails there.
    stepProgress(mirror.id, "export");
    let bundle: TaskBundle;
    try {
      ({ bundle } = await postIdempotent<{ bundle: TaskBundle }>(
        link,
        `${path}/export`,
        { to: os.hostname() },
        300000
      ));
    } catch (err) {
      mirrorRunning(mirror.id);
      if (unknownOutcome(err)) throw unconfirmed(link.hostName, err);
      throw err;
    }
    try {
      here = await importTask(bundle);
    } catch (err) {
      await tell(link, `${path}/resume`, { force: true }).catch((e) => {
        throw new Error(
          `${(err as Error).message}; and ${link.hostName} didn't resume it: ${e.message}`
        );
      });
      mirrorRunning(mirror.id);
      throw err;
    }
  }
  stepProgress(mirror.id, "confirm");
  // It runs here now. Until that machine marks its row moved (it stays
  // "moving" there, which nothing can sign off), the mirror stays, so Move
  // here again comes back to this.
  try {
    await tell(link, `${path}/moved`, { to: os.hostname() });
  } catch (err) {
    throw new Error(
      `It's running here now, but ${link.hostName} didn't confirm (${(err as Error).message}). Press Move here again to tidy up.`
    );
  }
  // The mirror was only how this machine showed it: the task is the new row.
  db.prepare(`DELETE FROM sessions WHERE id = ? AND host_id = ?`).run(
    mirror.id,
    mirror.host_id
  );
  forgetHostTasks(link.hostId);
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(here.id) as Session;
}
