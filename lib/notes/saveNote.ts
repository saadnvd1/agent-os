import { getDb } from "@/lib/db";
import { getNote, sessionExists } from "./getNote";
import {
  MAX_NOTE_BYTES,
  NoteError,
  type NoteDoc,
  type SessionNote,
} from "./types";

/** Replaces a session's note: last write wins. */
export function saveNote(sessionId: string, doc: NoteDoc): SessionNote {
  if (!sessionExists(sessionId)) throw new NoteError("Session not found", 404);
  const content = JSON.stringify(doc);
  if (Buffer.byteLength(content) > MAX_NOTE_BYTES)
    throw new NoteError(`Note is over ${MAX_NOTE_BYTES / 1024} KB`, 413);
  getDb()
    .prepare(
      `INSERT INTO session_notes (session_id, content, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(session_id) DO UPDATE SET
         content = excluded.content, updated_at = excluded.updated_at`
    )
    .run(sessionId, content);
  return getNote(sessionId);
}
