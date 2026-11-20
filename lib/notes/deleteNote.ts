import { getDb } from "@/lib/db";

export function deleteNote(sessionId: string): void {
  getDb()
    .prepare(`DELETE FROM session_notes WHERE session_id = ?`)
    .run(sessionId);
}
