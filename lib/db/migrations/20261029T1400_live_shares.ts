import type { Migration } from "../migration-types";

export default {
  key: "20261029T1400_live_shares",
  up: (db) => {
    // One row per live link this machine minted. The id is Connect's share id.
    db.exec(
      `CREATE TABLE IF NOT EXISTS live_shares (
         id TEXT PRIMARY KEY,
         session_id TEXT NOT NULL,
         title TEXT NOT NULL,
         url TEXT NOT NULL,
         ends_with_session INTEGER NOT NULL DEFAULT 0,
         max_guests INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         expires_at TEXT,
         ended_at TEXT
       )`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_live_shares_session ON live_shares(session_id)`
    );
    // What happened on a share, kept on this machine only: who asked to join,
    // who was let in, and each suggestion with the text actually sent.
    db.exec(
      `CREATE TABLE IF NOT EXISTS live_share_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         share_id TEXT NOT NULL,
         at INTEGER NOT NULL,
         kind TEXT NOT NULL,
         guest_id TEXT,
         guest_name TEXT,
         ref TEXT,
         text TEXT,
         sent_text TEXT
       )`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_live_share_log_share ON live_share_log(share_id, id)`
    );
  },
} satisfies Migration;
