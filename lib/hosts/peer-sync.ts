/**
 * A linked machine's sessions are sessions here: each one its AgentOS lists
 * gets a mirror row (the same id, that machine's host id), so the sidebar
 * shows it with the same row, menu and address as one started here. The row
 * is only how this machine shows it: that machine runs it, and actions on it
 * go there (peer-actions.ts).
 */

import { db, queries, type Project } from "../db";
import { isValidAgentType } from "../providers";
import { projectMatcher } from "./discover";
import type { PeerSession } from "./peer-sessions";

export function insertMirror(
  peer: PeerSession,
  projectId: string | null
): void {
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, model, group_path,
       agent_type, project_id, host_id, view, name_source, pr_url, pr_number,
       pr_status, updated_at)
     VALUES (?, ?, ?, ?, ?, 'sessions', ?, ?, ?, ?, 'user', ?, ?, ?,
       COALESCE(?, datetime('now')))
     ON CONFLICT(id) DO NOTHING`
  ).run(
    peer.id,
    peer.name,
    peer.tmuxName || `${peer.agentType}-${peer.id}`,
    peer.path || "~",
    peer.model,
    isValidAgentType(peer.agentType) ? peer.agentType : "shell",
    projectId,
    peer.hostId,
    peer.view,
    peer.prUrl,
    peer.prNumber,
    peer.prStatus,
    peer.updatedAt
  );
}

/**
 * Brings the mirrors of one machine in line with its listing: new sessions
 * get a row, listed ones take its name, view, PR and time, and a mirror it
 * listed before and doesn't now (deleted, archived or moved there) goes.
 * A task's mirror is left alone: its state comes from that machine's tasks.
 */
export function syncPeerMirrors(
  hostId: string,
  listed: PeerSession[],
  gone: string[]
): void {
  const projectFor = projectMatcher(
    queries.getAllProjects(db).all() as Project[]
  );
  const owner = db.prepare(`SELECT host_id FROM sessions WHERE id = ?`);
  const update = db.prepare(
    `UPDATE sessions SET name = ?, view = ?, tmux_name = ?, project_id = ?,
       pr_url = ?, pr_number = ?, pr_status = ?,
       updated_at = COALESCE(?, updated_at)
     WHERE id = ? AND host_id = ? AND task_prompt IS NULL
       AND NOT (name IS ? AND view IS ? AND tmux_name IS ? AND project_id IS ?
         AND pr_url IS ? AND pr_number IS ? AND pr_status IS ?
         AND updated_at IS COALESCE(?, updated_at))`
  );
  const drop = db.prepare(
    `DELETE FROM sessions WHERE id = ? AND host_id = ? AND task_prompt IS NULL
       AND archived_at IS NULL`
  );
  db.transaction(() => {
    for (const peer of listed) {
      const projectId = projectFor(hostId, peer.path);
      const row = owner.get(peer.id) as { host_id: string } | undefined;
      // An id that's this machine's own (a task moved there) stays its own.
      if (!row) {
        insertMirror(peer, projectId);
        continue;
      }
      if (row.host_id !== hostId) continue;
      const tmuxName = peer.tmuxName || `${peer.agentType}-${peer.id}`;
      const fields = [
        peer.name,
        peer.view,
        tmuxName,
        projectId,
        peer.prUrl,
        peer.prNumber,
        peer.prStatus,
        peer.updatedAt,
      ];
      update.run(...fields, peer.id, hostId, ...fields);
    }
    for (const id of gone) drop.run(id, hostId);
  })();
}
