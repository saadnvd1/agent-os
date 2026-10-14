import type { Migration } from "../migration-types";

export default {
  id: 67,
  name: "orchestrator_event_log_suppressed",
  up: (db) => {
    // A capped event is logged as suppressed so a drop leaves a trace.
    const columns = db
      .prepare(`PRAGMA table_info(orchestrator_event_log)`)
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "suppressed"))
      db.exec(`ALTER TABLE orchestrator_event_log ADD COLUMN suppressed TEXT`);
  },
} satisfies Migration;
