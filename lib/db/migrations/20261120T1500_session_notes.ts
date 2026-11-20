import type { Migration } from "../migration-types";

export default {
  key: "20261120T1500_session_notes",
  up: (db) => {
    // A session's scratch notes: one Tiptap document per session. No foreign
    // key: a note outlives Done and Archive, and is removed with the session
    // only when it is deleted for good (DELETE /api/sessions/:id).
    db.exec(`CREATE TABLE IF NOT EXISTS session_notes (
      session_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  },
} satisfies Migration;
