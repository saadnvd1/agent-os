import type { Migration } from "../migration-types";

export default {
  key: "20261020T1900_task_queue_after_claim",
  up: (db) => {
    // The work claim (lib/claims) a queued task waits on, by claim id.
    const cols = db.prepare(`PRAGMA table_info(task_queue)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "after_claim"))
      db.exec(`ALTER TABLE task_queue ADD COLUMN after_claim TEXT`);
  },
} satisfies Migration;
