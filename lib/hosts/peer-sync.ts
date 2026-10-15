/**
 * A linked machine's sessions are sessions here: each one its AgentOS lists
 * gets a mirror row (the same id, that machine's host id), so the sidebar
 * shows it with the same row, menu and address as one started here. The row
 * is only how this machine shows it: that machine runs it, and actions on it
 * go there (peer-actions.ts).
 */

import { db, queries, type Project, type Session } from "../db";
import { isValidAgentType } from "../providers";
import { projectMatcher } from "./discover";
import type { PeerSession } from "./peer-sessions";
import { setPlacement, setPr } from "../db/session-parts";

export function insertMirror(
  peer: PeerSession,
  projectId: string | null
): void {
  db.transaction(() => {
    const inserted = db
      .prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory, model, group_path,
           agent_type, project_id, host_id, view, name_source, updated_at)
         VALUES (?, ?, ?, ?, ?, 'sessions', ?, ?, ?, ?, 'user',
           COALESCE(?, datetime('now')))
         ON CONFLICT(id) DO NOTHING`
      )
      .run(
        peer.id,
        peer.name,
        peer.tmuxName || `${peer.agentType}-${peer.id}`,
        peer.path || "~",
        peer.model,
        isValidAgentType(peer.agentType) ? peer.agentType : "shell",
        projectId,
        peer.hostId,
        peer.view,
        peer.updatedAt
      );
    if (!inserted.changes) return;
    setPr(db, peer.id, {
      pr_url: peer.prUrl,
      pr_number: peer.prNumber,
      pr_status: peer.prStatus as Session["pr_status"],
    });
    setPlacement(db, peer.id, { peer_mirror: 1 });
  })();
}

// One listing mirrors at most this many: a listing is another machine's
// answer, and each entry becomes a row.
export const MAX_PEER_MIRRORS = 500;

/**
 * Brings the mirrors of one machine in line with its listing: new sessions
 * get a row, listed ones take its name, view, PR and time, and a mirror it
 * doesn't list (deleted, archived or moved there) goes. Read from the rows,
 * so a restart forgets nothing; only rows made before the listing was asked
 * for (`askedAt`, ms), so an older answer arriving late never drops a
 * session started since; and never from a cut-short listing. Rows that
 * aren't marked mirrors, and task mirrors, are left alone.
 */
export function syncPeerMirrors(
  hostId: string,
  listed: PeerSession[],
  askedAt: number
): void {
  const complete = listed.length <= MAX_PEER_MIRRORS;
  listed = listed.slice(0, MAX_PEER_MIRRORS);
  const projects = queries.getAllProjects(db).all() as Project[];
  const projectFor = projectMatcher(projects);
  const here = new Set(
    projects
      .filter((p) => !p.is_uncategorized && (p.host_id || "local") === "local")
      .map((p) => p.id)
  );
  const owner = db.prepare(
    `SELECT host_id, project_id FROM sessions WHERE id = ?`
  );
  // That machine lists the id, so it's its session: a row mirrored on open
  // before this column existed is marked too.
  const current = db.prepare(
    `SELECT name, view, tmux_name, project_id, pr_url, pr_number, pr_status,
       updated_at, peer_mirror
       FROM session_rows WHERE id = ? AND host_id = ? AND task_prompt IS NULL`
  );
  const touch = db.prepare(
    `UPDATE sessions SET name = ?, view = ?, tmux_name = ?, project_id = ?,
       updated_at = COALESCE(?, updated_at) WHERE id = ?`
  );
  const update = (
    peer: PeerSession,
    fields: (string | number | null)[]
  ): void => {
    const [name, view, tmuxName, projectId, prUrl, prNumber, prStatus, at] =
      fields;
    const cur = current.get(peer.id, hostId) as
      | Record<string, string | number | null>
      | undefined;
    if (!cur) return;
    const same =
      cur.name === name &&
      cur.view === view &&
      cur.tmux_name === tmuxName &&
      cur.project_id === projectId &&
      cur.pr_url === prUrl &&
      cur.pr_number === prNumber &&
      cur.pr_status === prStatus &&
      cur.updated_at === (at ?? cur.updated_at) &&
      cur.peer_mirror === 1;
    if (same) return;
    touch.run(name, view, tmuxName, projectId, at, peer.id);
    setPr(db, peer.id, {
      pr_url: prUrl as string | null,
      pr_number: prNumber as number | null,
      pr_status: prStatus as Session["pr_status"],
    });
    setPlacement(db, peer.id, { peer_mirror: 1 });
  };
  const mirrors = db.prepare(
    `SELECT id FROM session_rows WHERE host_id = ? AND peer_mirror = 1
       AND task_prompt IS NULL AND archived_at IS NULL
       AND created_at < datetime(?, 'unixepoch')`
  );
  const drop = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  db.transaction(() => {
    for (const peer of listed) {
      const row = owner.get(peer.id) as
        | { host_id: string; project_id: string | null }
        | undefined;
      // One started here for a project here keeps it (lib/hosts/peer-actions.ts).
      const kept =
        row?.project_id && here.has(row.project_id) ? row.project_id : null;
      const projectId = projectFor(hostId, peer.path) ?? kept;
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
      update(peer, fields);
    }
    if (!complete) return;
    const now = new Set(listed.map((p) => p.id));
    const rows = mirrors.all(hostId, Math.floor(askedAt / 1000)) as {
      id: string;
    }[];
    for (const { id } of rows) if (!now.has(id)) drop.run(id);
  })();
}
