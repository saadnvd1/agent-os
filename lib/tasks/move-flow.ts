/**
 * Move a task between this machine and a linked one. Every call it makes to
 * the other machine is safe to repeat (keyed by the source session), so a
 * move that can't tell whether it landed stays "moving" and Move again
 * finishes it. The agent resumes at the source only when the target said no.
 */

import os from "os";
import { db, type Session } from "../db";
import { isRemoteHost } from "../hosts";
import { hostApi, requireHostLink, type HostLink } from "../hosts/remote-api";
import { getTaskSession } from "./session";
import { exportOrResume, markMoved, resumeTask, type TaskBundle } from "./move";
import { importTask } from "./import";
import {
  forgetHostTasks,
  mirrorTask,
  postIdempotent,
  unknownOutcome,
} from "./remote";

const LIVE = new Set(["running", "moving"]);

export async function moveTask(id: string, toHostId: string): Promise<Session> {
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
  return toRemote ? moveOut(session, toHostId) : moveIn(session);
}

const unconfirmed = (where: string, err: unknown) =>
  new Error(
    `Couldn't confirm the move with ${where} (${(err as Error).message}). It's paused as "moving": press Move again to finish it.`
  );

async function moveOut(session: Session, hostId: string): Promise<Session> {
  const link = requireHostLink(hostId);
  const bundle = await exportOrResume(session.id, link.hostName);
  let arrived: Session;
  try {
    ({ session: arrived } = await postIdempotent<{ session: Session }>(
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
  db.transaction(() => {
    markMoved(session.id, link.hostName);
    mirrorTask(hostId, session.project_id, arrived);
  })();
  forgetHostTasks(hostId);
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(arrived.id) as Session;
}

async function tell(link: HostLink, path: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await hostApi(link, path, { body: { to: os.hostname() } });
      return;
    } catch (err) {
      if (!unknownOutcome(err) || i === 2) throw err;
    }
  }
}

async function moveIn(mirror: Session): Promise<Session> {
  const link = requireHostLink(mirror.host_id);
  const path = `/api/tasks/${encodeURIComponent(mirror.id)}`;
  // That machine resumes the agent itself if its half fails there.
  let bundle: TaskBundle;
  try {
    ({ bundle } = await postIdempotent<{ bundle: TaskBundle }>(
      link,
      `${path}/export`,
      { to: os.hostname() },
      300000
    ));
  } catch (err) {
    if (unknownOutcome(err)) throw unconfirmed(link.hostName, err);
    throw err;
  }
  let arrived: Session;
  try {
    arrived = await importTask(bundle);
  } catch (err) {
    await tell(link, `${path}/resume`).catch((e) => {
      throw new Error(
        `${(err as Error).message}; and ${link.hostName} didn't resume it: ${e.message}`
      );
    });
    throw err;
  }
  // It runs here now. Until that machine marks its row moved (it stays
  // "moving" there, which nothing can sign off), the mirror stays, so Move
  // here again repeats this and finds the task that already arrived.
  try {
    await tell(link, `${path}/moved`);
  } catch (err) {
    throw new Error(
      `It's running here now, but ${link.hostName} didn't confirm (${(err as Error).message}). Press Move here again to tidy up.`
    );
  }
  markMoved(mirror.id, os.hostname());
  forgetHostTasks(link.hostId);
  return arrived;
}
