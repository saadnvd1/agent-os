import type { Migration } from "../migration-types";

export default {
  id: 11,
  name: "add_tmux_name_to_sessions",
  up: (db) => {
    db.exec(`ALTER TABLE sessions ADD COLUMN tmux_name TEXT`);
    // Backfill existing sessions with computed tmux name
    db.exec(
      `UPDATE sessions SET tmux_name = agent_type || '-' || id WHERE tmux_name IS NULL`
    );
  },
} satisfies Migration;
