import type { Migration } from "../migration-types";

export default {
  key: "20261014T1800_task_starter_device",
  up: (db) => {
    // The paired device that started a task over the API: the only one
    // that may later hold it. Tasks already running have no record, so
    // they're marked unrecorded. Additive.
    const has = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).some((c) => c.name === "started_by_device");
    if (!has) db.exec(`ALTER TABLE sessions ADD COLUMN started_by_device TEXT`);
    db.exec(`
        UPDATE sessions SET started_by_device = 'unrecorded'
        WHERE started_by_device IS NULL AND started_by IS NULL
          AND held_by_device IS NULL AND task_status = 'running'
          AND task_prompt IS NOT NULL AND (host_id IS NULL OR host_id = 'local')
      `);
  },
} satisfies Migration;
