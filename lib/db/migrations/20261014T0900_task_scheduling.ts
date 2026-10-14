import type { Migration } from "../migration-types";

export default {
  key: "20261014T0900_task_scheduling",
  up: (db) => {
    // Priority, "after any" consumption, and timed pause. Additive: every
    // existing row reads as normal priority and not paused.
    const has = (table: string, col: string) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).some((c) => c.name === col);
    const add = (table: string, col: string, def: string) => {
      if (!has(table, col))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    };
    add("task_queue", "priority", "TEXT NOT NULL DEFAULT 'normal'");
    add("task_queue", "machine_needs", "TEXT");
    add("task_queue", "after_any_used", "TEXT");
    add("task_queue", "wait_code", "TEXT");
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_task_queue_after_any_used
           ON task_queue(after_any_used) WHERE after_any_used IS NOT NULL`
    );
    add("sessions", "priority", "TEXT");
    add("sessions", "pause_state", "TEXT");
    add("sessions", "paused_until", "TEXT");
    add("sessions", "pause_id", "INTEGER");
    // "Started on <machine> · <why>" for a task the scheduler placed.
    add("sessions", "placed_note", "TEXT");
    add("bus_messages", "held_pause_id", "INTEGER");
    add("projects", "machine_needs", "TEXT");
    add("projects", "machine_needs_source", "TEXT");
    db.exec(`
        CREATE TABLE IF NOT EXISTS task_pauses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'turn',
          by_kind TEXT NOT NULL DEFAULT 'person',
          by_id TEXT,
          reason TEXT,
          until_at TEXT,
          state TEXT NOT NULL DEFAULT 'pausing',
          requested_at TEXT NOT NULL DEFAULT (datetime('now')),
          paused_at TEXT,
          resume_requested_at TEXT,
          resume_by_kind TEXT,
          resumed_at TEXT,
          ended_at TEXT,
          end_reason TEXT,
          interrupted INTEGER NOT NULL DEFAULT 0,
          held_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_task_pauses_session
          ON task_pauses(session_id, state);
      `);
  },
} satisfies Migration;
