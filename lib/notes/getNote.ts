import { getDb } from "@/lib/db";
import type { NoteDoc, SessionNote } from "./types";

interface Row {
  content: string;
  updated_at: string;
}

export function getNote(sessionId: string): SessionNote {
  const row = getDb()
    .prepare(
      `SELECT content, updated_at FROM session_notes WHERE session_id = ?`
    )
    .get(sessionId) as Row | undefined;
  return {
    sessionId,
    doc: row ? (JSON.parse(row.content) as NoteDoc) : null,
    updatedAt: row?.updated_at ?? null,
  };
}

export const sessionExists = (sessionId: string): boolean =>
  !!getDb().prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sessionId);
