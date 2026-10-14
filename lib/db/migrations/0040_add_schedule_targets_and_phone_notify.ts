import type { Migration } from "../migration-types";

export default {
  id: 40,
  name: "add_schedule_targets_and_phone_notify",
  // One transaction, so a crash part-way leaves nothing to skip as
  // "duplicate column" on the next start.
  up: (db) =>
    db.transaction(() => {
      // Where phone notifications go. One row; the bot token is never
      // returned by any route or written to a log.
      db.exec(`
          CREATE TABLE IF NOT EXISTS notify_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            telegram_token TEXT,
            telegram_chat_id TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
      // Every phone notification, sent or waiting out its source's
      // minute, so one held across a restart still goes.
      db.exec(`
          CREATE TABLE IF NOT EXISTS notify_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            send_after INTEGER NOT NULL,
            sent_at INTEGER,
            error TEXT
          )
        `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_notify_outbox_source ON notify_outbox(source, sent_at)`
      );
      // A "message" schedule's session, by id: names change, ids don't.
      // And the agent session that made a schedule, when one did.
      db.exec(`ALTER TABLE schedules ADD COLUMN target_session_id TEXT`);
      db.exec(`ALTER TABLE schedules ADD COLUMN created_by_session_id TEXT`);
    })(),
} satisfies Migration;
