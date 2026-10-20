import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_WORK_CLAIMS } from "../changes";

export default {
  key: "20261020T2200_work_claims_watch",
  up: (db) => {
    // The claims sheet and the overlap pills refetch when a claim changes.
    installChangeTriggers(db, TABLES_WATCHED_WORK_CLAIMS);
  },
} satisfies Migration;
