import { db } from "../db";

export interface SharedLink {
  id: string;
  url: string;
  kind: "chat" | "artifact";
  title: string;
  session_id: string | null;
  artifact_id: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  follow_latest: number;
  // The page version the link shows now.
  version: number | null;
}

export function insertSharedLink(link: SharedLink): void {
  db.prepare(
    `INSERT INTO shared_links
       (id, url, kind, title, session_id, artifact_id, expires_at, created_at, revoked_at, follow_latest, version)
     VALUES (@id, @url, @kind, @title, @session_id, @artifact_id, @expires_at, @created_at, @revoked_at, @follow_latest, @version)`
  ).run(link);
}

export function listSharedLinks(): SharedLink[] {
  return db
    .prepare(`SELECT * FROM shared_links ORDER BY created_at DESC, rowid DESC`)
    .all() as SharedLink[];
}

export function getSharedLink(id: string): SharedLink | undefined {
  return db.prepare(`SELECT * FROM shared_links WHERE id = ?`).get(id) as
    SharedLink | undefined;
}

export function markRevoked(id: string): void {
  db.prepare(
    `UPDATE shared_links SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?`
  ).run(new Date().toISOString(), id);
}

/** Live follow-latest links to any version of a page. */
export function listFollowing(pageId: string): SharedLink[] {
  return db
    .prepare(
      `SELECT l.* FROM shared_links l JOIN artifacts a ON a.id = l.artifact_id
       WHERE a.page_id = ? AND l.follow_latest = 1 AND l.revoked_at IS NULL
         AND (l.expires_at IS NULL OR l.expires_at > ?)
       ORDER BY l.created_at, l.rowid`
    )
    .all(pageId, new Date().toISOString()) as SharedLink[];
}

export function setLinkVersion(
  id: string,
  version: number,
  title: string
): void {
  db.prepare(`UPDATE shared_links SET version = ?, title = ? WHERE id = ?`).run(
    version,
    title,
    id
  );
}

/** Connect no longer has it: stop trying. */
export function stopFollowing(id: string): void {
  db.prepare(`UPDATE shared_links SET follow_latest = 0 WHERE id = ?`).run(id);
}
