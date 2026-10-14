import type { Migration } from "../migration-types";

export default {
  id: 65,
  name: "orchestrator_triage",
  up: (db) => {
    // started_by: the orchestrator session that started this one (null: a
    // person). plan_decided: 1 planned, 0 no plan, null not stated.
    const add = (table: string, col: string, type: string) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === col))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    };
    add("sessions", "started_by", "TEXT");
    add("sessions", "plan_decided", "INTEGER");
    add("sessions", "plan_reason", "TEXT");
    add("task_queue", "plan", "INTEGER");
    add("task_queue", "plan_reason", "TEXT");
    add("task_queue", "started_by", "TEXT");
  },
} satisfies Migration;
