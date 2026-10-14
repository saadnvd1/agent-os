import type { Migration } from "../migration-types";

export default {
  id: 76,
  name: "welcome_backfill",
  up: (db) => {
    // An install that already has a session or a project of its own has
    // been set up; mark it so the first-run welcome never shows there.
    db.exec(
      `INSERT OR IGNORE INTO settings (key, value)
         SELECT 'welcome.completed_at', 'existing-install'
         WHERE EXISTS (SELECT 1 FROM sessions)
            OR EXISTS (SELECT 1 FROM projects WHERE is_uncategorized = 0)`
    );
  },
} satisfies Migration;
