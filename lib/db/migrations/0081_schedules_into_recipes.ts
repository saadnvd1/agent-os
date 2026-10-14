import type { Migration } from "../migration-types";
import { moveSchedulesToRecipes } from "../schedules-move";

export default {
  id: 81,
  name: "schedules_into_recipes",
  up: (db) => {
    // Live task and session schedules become recipes with a timer, and
    // their runs become recipe runs (lib/db/schedules-move). Reversible:
    // scripts/revert-schedules-move.ts.
    const cols = (
      db.prepare(`PRAGMA table_info(schedules)`).all() as { name: string }[]
    ).map((c) => c.name);
    if (!cols.includes("recipe_id") || !cols.includes("migrated_from_kind"))
      throw new Error("migration 80 hasn't run");
    moveSchedulesToRecipes(db);
  },
} satisfies Migration;
