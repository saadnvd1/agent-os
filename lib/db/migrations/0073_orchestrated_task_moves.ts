import type { Migration } from "../migration-types";

export default {
  id: 73,
  name: "orchestrated_task_moves",
  up: (db) => {
    // task_since: when the task first started, kept across moves (null:
    // created_at). held_by_device / held_from: the device and machine of
    // the orchestrator that moved this task here; only that device may
    // merge, arm, message or move it. plan_note: the "plan written" line
    // of a held task, for its orchestrator to read.
    const add = (col: string) => {
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === col))
        db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
    };
    for (const col of [
      "task_since",
      "held_by_device",
      "held_from",
      "plan_note",
    ])
      add(col);
  },
} satisfies Migration;
