import type { Migration } from "../migration-types";

export default {
  id: 75,
  name: "plan_only_tasks",
  up: (db) => {
    // plan_only: 1 for a task that stops after its plan and waits for
    // approval (plan_phase 'awaiting'); queued tasks keep it until they start.
    const has = (table: string) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).some((c) => c.name === "plan_only");
    for (const table of ["sessions", "task_queue"])
      if (!has(table))
        db.exec(`ALTER TABLE ${table} ADD COLUMN plan_only INTEGER`);
  },
} satisfies Migration;
