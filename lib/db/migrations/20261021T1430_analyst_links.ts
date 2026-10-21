import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_ANALYST } from "../changes";

export default {
  key: "20261021T1430_analyst_links",
  up: (db) => {
    // A coding chat paired with an analyst chat that reviews each of its
    // turns (lib/analyst). Rows are kept after unlinking.
    db.exec(`
      CREATE TABLE IF NOT EXISTS analyst_links (
        id TEXT PRIMARY KEY,
        coder_session_id TEXT NOT NULL,
        analyst_session_id TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        reviewed_through TEXT,
        pending_digest_id TEXT,
        pending_through TEXT,
        digest_signals TEXT,
        created_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS analyst_links_coder_live
        ON analyst_links(coder_session_id) WHERE ended_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS analyst_links_analyst
        ON analyst_links(analyst_session_id);
      CREATE TABLE IF NOT EXISTS analyst_recommendations (
        id TEXT PRIMARY KEY,
        link_id TEXT NOT NULL,
        analyst_item_id TEXT NOT NULL,
        coder_through TEXT,
        verdict TEXT,
        summary TEXT NOT NULL DEFAULT '',
        issues TEXT NOT NULL DEFAULT '[]',
        signals TEXT,
        prompt TEXT,
        state TEXT NOT NULL DEFAULT 'open',
        error TEXT,
        sent_text TEXT,
        sent_item_id TEXT,
        edited INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS analyst_recs_item
        ON analyst_recommendations(link_id, analyst_item_id);
      CREATE INDEX IF NOT EXISTS analyst_recs_link
        ON analyst_recommendations(link_id, created_at);
    `);
    // The pane's card and the sidebar refetch when either changes.
    installChangeTriggers(db, TABLES_WATCHED_ANALYST);
  },
} satisfies Migration;
