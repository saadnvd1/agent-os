import type { Migration } from "../migration-types";

export default {
  id: 72,
  name: "push_outbox",
  up: (db) => {
    // One row per (event, device). device_id is '' for a row folded into
    // the Away digest. state: pending, sending, sent, failed, gone,
    // capped, superseded, folded, digested.
    db.exec(`
        CREATE TABLE IF NOT EXISTS push_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_key TEXT NOT NULL,
          device_id TEXT NOT NULL,
          category TEXT NOT NULL,
          level TEXT NOT NULL,
          payload TEXT NOT NULL,
          collapse_id TEXT,
          state TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          sent_at INTEGER,
          error TEXT,
          fallback_source TEXT,
          fallback_text TEXT,
          UNIQUE(event_key, device_id)
        );
        CREATE INDEX IF NOT EXISTS idx_push_outbox_due ON push_outbox(state, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_push_outbox_device ON push_outbox(device_id, sent_at);
      `);
  },
} satisfies Migration;
