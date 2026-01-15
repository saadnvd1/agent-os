import { getDb } from "@/lib/db";
import { generateSessionId, getAuthConfig } from "./index";

export interface AuthSession {
  id: string;
  session_id: string;
  created_at: string;
  expires_at: string;
}

export function createSession(): { sessionId: string; expiresAt: Date } {
  const db = getDb();
  const config = getAuthConfig();

  const sessionId = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000
  );

  db.prepare(
    `INSERT INTO auth_sessions (session_id, expires_at) VALUES (?, ?)`
  ).run(sessionId, expiresAt.toISOString());

  return { sessionId, expiresAt };
}

export function getSession(sessionId: string): AuthSession | null {
  const db = getDb();

  const session = db
    .prepare(
      `SELECT * FROM auth_sessions WHERE session_id = ? AND expires_at > datetime('now')`
    )
    .get(sessionId) as AuthSession | undefined;

  return session || null;
}

export function deleteSession(sessionId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM auth_sessions WHERE session_id = ?`).run(sessionId);
}

export function cleanupExpiredSessions(): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM auth_sessions WHERE expires_at <= datetime('now')`)
    .run();
  return result.changes;
}
