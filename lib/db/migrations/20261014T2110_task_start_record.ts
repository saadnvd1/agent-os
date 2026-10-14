import type { Migration } from "../migration-types";

export default {
  key: "20261014T2110_task_start_record",
  up: (db) => {
    // Who started a task and how, on the session and its queue row; an
    // approval kind on brief entries. Additive.
    const add = (table: string, col: string, type: string) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === col))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    };
    add("sessions", "started_via", "TEXT");
    add("task_queue", "parent_session_id", "TEXT");
    add("task_queue", "started_by_device", "TEXT");
    add("task_queue", "started_via", "TEXT");
    add("brief_amendments", "kind", "TEXT NOT NULL DEFAULT 'scope'");
  },
} satisfies Migration;
