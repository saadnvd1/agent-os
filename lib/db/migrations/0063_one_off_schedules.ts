import type { Migration } from "../migration-types";

export default {
  id: 63,
  name: "one_off_schedules",
  up: (db) =>
    db.transaction(() => {
      // A one-off has a run time (epoch ms, UTC) and no cron; done_at is
      // set once its single run settles. Recurring rows leave both NULL.
      db.exec(`ALTER TABLE schedules ADD COLUMN run_at INTEGER`);
      db.exec(`ALTER TABLE schedules ADD COLUMN done_at INTEGER`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_schedules_run_at ON schedules(run_at) WHERE run_at IS NOT NULL`
      );
    })(),
} satisfies Migration;
