import type { Migration } from "../migration-types";

export default {
  id: 88,
  name: "shared_links",
  up: (db) => {
    // Snapshot links made through Connect. Connect keeps only a digest of
    // the token, so this is the one place the link can be copied again.
    db.exec(`
        CREATE TABLE IF NOT EXISTS shared_links (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          session_id TEXT,
          artifact_id TEXT,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_shared_links_created
          ON shared_links(created_at DESC);
      `);
  },
} satisfies Migration;
