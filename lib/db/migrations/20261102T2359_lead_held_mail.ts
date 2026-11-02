import type { Migration } from "../migration-types";

export default {
  key: "20261102T2359_lead_held_mail",
  up: (db) => {
    // A lead message the loop guard held, kept with the owner's ask until
    // it's answered: 'held' -> 'delivered' or 'dropped', once.
    db.exec(`CREATE TABLE IF NOT EXISTS lead_held_mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      from_kind TEXT NOT NULL,
      to_kind TEXT NOT NULL,
      thread TEXT NOT NULL,
      text TEXT NOT NULL,
      pins TEXT,
      sender_session_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'held',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  },
} satisfies Migration;
