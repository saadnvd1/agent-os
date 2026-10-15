import type { Migration } from "../migration-types";

export default {
  key: "20261015T1600_plan_waits_for_caller",
  up: (db) => {
    // A plan another machine placed here: it stops at the plan for that
    // machine to decide what comes next. On the machine that placed it, the
    // approval's message waits for the move home. Additive.
    const add = (col: string, type: string) => {
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === col))
        db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${type}`);
    };
    add("plan_waits_for_caller", "INTEGER");
    add("plan_handoff_message", "TEXT");
  },
} satisfies Migration;
