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
}

export function insertSharedLink(link: SharedLink): void {
  db.prepare(
    `INSERT INTO shared_links
       (id, url, kind, title, session_id, artifact_id, expires_at, created_at, revoked_at)
     VALUES (@id, @url, @kind, @title, @session_id, @artifact_id, @expires_at, @created_at, @revoked_at)`
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
