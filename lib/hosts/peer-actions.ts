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
import { isValidTmuxName } from "./attach";
import { homeRelative } from "./discover";
import { toPeerSession } from "./peer-sessions";
import { insertMirror } from "./peer-sync";
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

/**
 * The link for a mirror of a linked machine's own session. A session this
 * machine started there over ssh, or one of its tasks, isn't one.
 */
export function peerSessionLink(
  session: Pick<Session, "host_id" | "task_prompt" | "peer_mirror">
): HostLink | null {
  return session.peer_mirror && !session.task_prompt
    ? peerLinkOf(session)
    : null;
}

type PeerRow = {
  id?: unknown;
  role?: unknown;
  task_prompt?: unknown;
  task_status?: unknown;
};

/**
 * What that machine says the session is now; null when it has none. An
 * answer that isn't about this session is refused, never read as "fine".
 */
async function peerRow(
  link: HostLink,
  session: Session
): Promise<PeerRow | null> {
  let there: PeerRow | undefined;
  try {
    ({ session: there } = await hostApi<{ session?: PeerRow }>(
      link,
      path(session.id),
      { timeout: 8000 }
    ));
  } catch (err) {
    if (err instanceof HostApiError && err.status === 404) return null;
    throw err;
  }
  if (!there || typeof there !== "object" || there.id !== session.id)
    throw new Error(
      `${link.hostName} didn't say what ${session.name} is there; nothing was done`
    );
  return there;
}

const isTaskThere = (there: PeerRow) =>
  !!(there.task_prompt || there.task_status);

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
    typeof there?.tmux_name === "string" &&
    there.tmux_name.length <= 200 &&
    isValidTmuxName(there.tmux_name)
      ? there.tmux_name
      : session.tmux_name;
  db.prepare(
    `UPDATE sessions SET name = ?, tmux_name = ?, name_source = 'user',
       updated_at = datetime('now') WHERE id = ?`
  ).run(cleanRemoteText(there?.name) || name, tmuxName, session.id);
  return row(session.id);
}

/**
 * Deleted there, then here. One that machine no longer has goes here too;
 * one that is a task there is dropped there, not deleted from here.
 */
export async function deleteOnPeer(
  link: HostLink,
  session: Session
): Promise<void> {
  const there = await peerRow(link, session);
  if (there && isTaskThere(there))
    throw new Error(
      `${session.name} is a task on ${link.hostName}: drop it in Tasks there.`
    );
  if (there) {
    try {
      await hostApi(link, path(session.id), { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof HostApiError && err.status === 404)) throw err;
    }
  }
  stopChat(session.id);
  deleteItems(session.id);
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(session.id);
}

/**
 * Done on that machine, which stops it and cleans up as its own done does.
 * Never a merge: only a plain session there is asked (a task mirror here
 * takes done's own path, through this machine's gates), and an answer that
 * can't say what it is refuses.
 */
export async function doneOnPeer(
  link: HostLink,
  session: Session
): Promise<DoneOutcome> {
  if (session.archived_at)
    throw new Error(`${session.name} is already archived.`);
  // What that machine says it is now, not what the mirror last heard.
  const there = await peerRow(link, session);
  if (!there)
    throw new Error(`${link.hostName} no longer has ${session.name}.`);
  if (isTaskThere(there))
    throw new Error(
      `${session.name} is a task on ${link.hostName}: sign it off or drop it in Tasks there.`
    );
  if (there.role)
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

export interface PeerStart {
  // This machine's project, and the folder to use when that machine has
  // no project there.
  project: { id: string; working_directory: string } | null;
  folder: string;
  agentType: string;
  model?: string | null;
  access?: string;
  name?: string | null;
  prompt?: string;
  view?: "chat" | "terminal";
}

/**
 * A new session on a linked machine, started by its own AgentOS (so it
 * opens in chat there like here) and mirrored here. Its project there is
 * the one at the same folder, relative to ~.
 */
export async function startOnPeer(
  link: HostLink,
  start: PeerStart
): Promise<{ session: Session; initialPrompt?: string }> {
  const dir = homeRelative(start.project?.working_directory ?? start.folder);
  const { projects } = await hostApi<{ projects?: unknown[] }>(
    link,
    "/api/projects",
    { timeout: 8000 }
  );
  const there = (Array.isArray(projects) ? projects : [])
    .map((p) => (p ?? {}) as Record<string, unknown>)
    .find(
      (p) =>
        !p.is_uncategorized &&
        typeof p.working_directory === "string" &&
        homeRelative(p.working_directory) === dir
    );
  // No retry: a start isn't safe to repeat.
  const res = await hostApi<{ session?: unknown; initialPrompt?: unknown }>(
    link,
    "/api/sessions",
    {
      body: {
        ...(there && typeof there.id === "string"
          ? { projectId: there.id }
          : { workingDirectory: start.folder }),
        agentType: start.agentType,
        model: start.model ?? undefined,
        access: start.access,
        name: start.name ?? undefined,
        prompt: start.prompt || undefined,
        view: start.view,
      },
      timeout: 60000,
    }
  );
  const peer = toPeerSession(
    link.hostId,
    (res.session ?? {}) as Record<string, unknown>
  );
  if (!peer) throw new Error(`${link.hostName} started something unreadable`);
  insertMirror(peer, start.project?.id ?? null);
  const initialPrompt =
    typeof res.initialPrompt === "string"
      ? res.initialPrompt.slice(0, 100_000)
      : undefined;
  return { session: row(peer.id), initialPrompt };
}
