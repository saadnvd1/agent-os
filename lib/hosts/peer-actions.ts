/**
 * Actions on a linked machine's session run on that machine, through its
 * AgentOS with the link's token, and then bring the mirror here in line.
 * Anything its AgentOS can't be asked to do yet is refused with the reason
 * (the menu shows the same reasons: lib/hosts/remote-menu.ts).
 */

import { db, type Session } from "../db";
import { stopChat } from "../chat/runner";
import { deleteItems } from "../chat/store";
import { archiveSession, unarchiveSession } from "../done/archive";
import type { DoneOutcome } from "../done";
import { isRemoteHost } from "./index";
import {
  HostApiError,
  cleanRemoteText,
  hostApi,
  hostLink,
  type HostLink,
} from "./remote-api";

/** The link to the machine that runs this session, when it's a linked one's. */
export function peerLinkOf(session: Pick<Session, "host_id">): HostLink | null {
  return isRemoteHost(session.host_id) ? hostLink(session.host_id) : null;
}

/** A session a linked machine runs that isn't one of this machine's tasks. */
export function peerSessionLink(
  session: Pick<Session, "host_id" | "task_prompt">
): HostLink | null {
  return session.task_prompt ? null : peerLinkOf(session);
}

const path = (id: string, rest = "") =>
  `/api/sessions/${encodeURIComponent(id)}${rest}`;

const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;

export async function renameOnPeer(
  link: HostLink,
  session: Session,
  name: string
): Promise<Session> {
  const { session: there } = await hostApi<{
    session?: { name?: unknown; tmux_name?: unknown };
  }>(link, path(session.id), { method: "PATCH", body: { name } });
  const tmuxName =
    typeof there?.tmux_name === "string" && there.tmux_name
      ? there.tmux_name.slice(0, 200)
      : session.tmux_name;
  db.prepare(
    `UPDATE sessions SET name = ?, tmux_name = ?, name_source = 'user',
       updated_at = datetime('now') WHERE id = ?`
  ).run(cleanRemoteText(there?.name) || name, tmuxName, session.id);
  return row(session.id);
}

/** Deleted there, then here. One that machine no longer has goes here too. */
export async function deleteOnPeer(
  link: HostLink,
  session: Session
): Promise<void> {
  try {
    await hostApi(link, path(session.id), { method: "DELETE" });
  } catch (err) {
    if (!(err instanceof HostApiError && err.status === 404)) throw err;
  }
  stopChat(session.id);
  deleteItems(session.id);
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(session.id);
}

/**
 * Done on that machine, which stops it and cleans up as its own done does.
 * Never a merge: a task mirror here takes done's own path (its merge goes
 * through this machine's gates), and one that is a task there is refused.
 */
export async function doneOnPeer(
  link: HostLink,
  session: Session
): Promise<DoneOutcome> {
  const tasks = `${session.name} is a task on ${link.hostName}: sign it off or drop it in Tasks there.`;
  if (session.archived_at)
    throw new Error(`${session.name} is already archived.`);
  // What that machine says it is now, not what the mirror last heard.
  const { session: there } = await hostApi<{
    session?: { task_prompt?: unknown; role?: unknown };
  }>(link, path(session.id), { timeout: 8000 });
  if (there?.task_prompt) throw new Error(tasks);
  if (there?.role)
    throw new Error(`${session.name} isn't marked done on ${link.hostName}.`);
  const { outcome } = await hostApi<{
    outcome?: { text?: unknown; worktree?: { action?: unknown } };
  }>(link, path(session.id, "/done"), { body: {}, timeout: 120000 });
  archiveSession(session.id);
  const removed = outcome?.worktree?.action === "removed";
  return {
    id: session.id,
    name: session.name,
    merged: null,
    worktree: removed
      ? { action: "removed", why: `on ${link.hostName}` }
      : { action: "none" },
    text: `${link.hostName}: ${cleanRemoteText(outcome?.text) || `Done: ${session.name}.`}`,
  };
}

export async function unarchiveOnPeer(
  link: HostLink,
  session: Session
): Promise<Session> {
  await hostApi(link, path(session.id, "/unarchive"), { body: {} });
  return unarchiveSession(session.id);
}
