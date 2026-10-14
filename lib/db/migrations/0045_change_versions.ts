import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_45 } from "../changes";

export default {
  id: 45,
  name: "change_versions",
  up: (db) => {
    // What browsers show from these tables is pushed when they change
    // (lib/db/changes.ts) instead of polled. A table added later gets its
    // own migration.
    installChangeTriggers(db, TABLES_WATCHED_45);
  },
} satisfies Migration;
