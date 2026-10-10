/**
 * Opening a linked machine's session here: a mirror row (the same id, that
 * machine's host id) so it sits in the sidebar and opens like any other.
 * Its terminal and chat are relayed to that machine's AgentOS, which runs
 * it; the row is only how this machine shows it.
 */

import { db, queries, type Project, type Session } from "../db";
import { isValidAgentType } from "../providers";
import { projectMatcher } from "./discover";
import { toPeerSession } from "./peer-sessions";
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
  const projectId = projectMatcher(
    queries.getAllProjects(db).all() as Project[]
  )(hostId, peer.path);
  const model = typeof raw?.model === "string" ? raw.model.slice(0, 100) : "";
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, model, group_path,
       agent_type, project_id, host_id, view, name_source)
     VALUES (?, ?, ?, ?, ?, 'sessions', ?, ?, ?, ?, 'user')
     ON CONFLICT(id) DO NOTHING`
  ).run(
    peer.id,
    peer.name,
    peer.tmuxName || `${peer.agentType}-${peer.id}`,
    peer.path || "~",
    model,
    isValidAgentType(peer.agentType) ? peer.agentType : "shell",
    projectId,
    hostId,
    peer.view
  );
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(peer.id) as Session;
}
