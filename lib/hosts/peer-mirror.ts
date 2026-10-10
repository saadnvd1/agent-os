/**
 * Opening a linked machine's session here: a mirror row (the same id, that
 * machine's host id) so it sits in the sidebar and opens like any other.
 * Its terminal and chat are relayed to that machine's AgentOS, which runs
 * it; the row is only how this machine shows it.
 */

import { db, queries, type Project, type Session } from "../db";
import { projectMatcher } from "./discover";
import { toPeerSession } from "./peer-sessions";
import { insertMirror } from "./peer-sync";
import { hostApi, requireHostLink } from "./remote-api";

export async function mirrorPeerSession(
  hostId: string,
  sessionId: string
): Promise<Session> {
  const existing = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (existing) {
    if (existing.host_id !== hostId)
      throw new Error("A session with that id already exists here");
    return existing;
  }
  const link = requireHostLink(hostId);
  // What that machine says now, not what a caller says it said.
  const { sessions } = await hostApi<{ sessions?: unknown[] }>(
    link,
    "/api/sessions",
    { timeout: 8000 }
  );
  const raw = (Array.isArray(sessions) ? sessions : []).find(
    (s) => (s as { id?: unknown })?.id === sessionId
  ) as Record<string, unknown> | undefined;
  const peer = raw ? toPeerSession(hostId, raw) : null;
  if (!peer) throw new Error(`${link.hostName} has no such session`);
  insertMirror(
    peer,
    projectMatcher(queries.getAllProjects(db).all() as Project[])(
      hostId,
      peer.path
    )
  );
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(peer.id) as Session;
}
