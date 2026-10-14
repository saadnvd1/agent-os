import type { Migration } from "../migration-types";

export default {
  key: "20261014T1235_placed_mirror_started_by",
  up: (db) => {
    // A task the queue started on a linked machine kept no record of the
    // orchestrator that queued it, so it couldn't be read, messaged or
    // stopped from there. Fills the mirror from the queue row; additive,
    // only where the mirror has none.
    db.exec(`
        UPDATE sessions SET
          started_by = (SELECT q.started_by FROM task_queue q WHERE q.id = sessions.id),
          task_since = COALESCE(task_since, created_at)
        WHERE started_by IS NULL AND task_prompt IS NOT NULL
          AND host_id IS NOT NULL AND host_id != 'local'
          AND (SELECT q.started_by FROM task_queue q WHERE q.id = sessions.id) IS NOT NULL
      `);
  },
} satisfies Migration;
