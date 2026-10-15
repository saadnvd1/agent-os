import type { Migration } from "../migration-types";
import type { PartTable } from "../session-parts/columns";
import { createSessionRowsView } from "../session-parts/view";

// The split of sessions into focused tables, as it was when this shipped:
// frozen here, so changing the live split never changes what this did.
const PARTS: Record<string, { columns: [string, string][] }> = {
  session_tasks: {
    columns: [
      ["task_prompt", "TEXT"],
      ["task_brief", "TEXT"],
      ["task_status", "TEXT"],
      ["task_since", "TEXT"],
      ["task_ended_at", "TEXT"],
      ["merged_at", "TEXT"],
      ["priority", "TEXT"],
      ["quick_of", "TEXT"],
      ["moved_to", "TEXT"],
      ["moved_from", "TEXT"],
      ["model_overrides", "TEXT"],
      ["lh_card_id", "TEXT"],
      ["lh_board_id", "TEXT"],
      ["lh_card_list", "TEXT"],
    ],
  },
  session_prs: {
    columns: [
      ["pr_url", "TEXT"],
      ["pr_number", "INTEGER"],
      ["pr_status", "TEXT"],
      ["merge_armed_at", "TEXT"],
      ["merge_armed_seen", "TEXT"],
      ["rebased_from", "TEXT"],
      ["rebased_to", "TEXT"],
      ["rebase_asked_head", "TEXT"],
      ["pr_wake_since", "TEXT"],
    ],
  },
  session_plans: {
    columns: [
      ["plan_phase", "TEXT"],
      ["plan_only", "INTEGER"],
      ["plan_decided", "INTEGER"],
      ["plan_reason", "TEXT"],
      ["plan_note", "TEXT"],
      ["plan_edits", "TEXT"],
      ["plan_waits_for_caller", "INTEGER"],
      ["plan_handoff_message", "TEXT"],
    ],
  },
  session_placement: {
    columns: [
      ["peer_mirror", "INTEGER NOT NULL DEFAULT 0"],
      ["placed_note", "TEXT"],
      ["held_by_device", "TEXT"],
      ["held_from", "TEXT"],
      ["held_for", "TEXT"],
      ["held_for_name", "TEXT"],
      ["started_by_device", "TEXT"],
    ],
  },
  session_pauses: {
    columns: [
      ["pause_state", "TEXT"],
      ["paused_until", "TEXT"],
      ["pause_id", "INTEGER"],
      ["pause_note", "TEXT"],
    ],
  },
};

const hasValue = (prefix: string, column: string) =>
  column === "peer_mirror"
    ? `COALESCE(${prefix}.${column}, 0) != 0`
    : `${prefix}.${column} IS NOT NULL`;

export default {
  key: "20261015T1800_split_sessions_tables",
  up: (db) => {
    // Additive: five tables, each keyed by the session and holding a row only
    // for a session with a value in its group; the session_rows view that
    // reads them back as one flat row; and triggers that keep a write to a
    // legacy sessions column (an older build, a chat worker that has not
    // restarted) landing in the new tables. No sessions column is touched.
    // Writers in this build go through lib/db/session-parts. Dropping the old
    // columns is a later step (docs/decisions/2026-10-15-split-sessions-table.md).
    db.transaction(() => {
      for (const [table, { columns }] of Object.entries(PARTS)) {
        const names = columns.map(([name]) => name);

        db.exec(
          `CREATE TABLE IF NOT EXISTS ${table} (
             session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
             ${columns.map(([n, type]) => `${n} ${type}`).join(",\n             ")}
           )`
        );

        const anyValue = (prefix: string) =>
          names.map((n) => hasValue(prefix, n)).join(" OR ");
        db.exec(
          `INSERT OR IGNORE INTO ${table} (session_id, ${names.join(", ")})
           SELECT s.id, ${names.map((n) => `s.${n}`).join(", ")}
             FROM sessions s WHERE ${anyValue("s")}`
        );

        db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_from_sessions_ins
             AFTER INSERT ON sessions
             WHEN ${anyValue("NEW")}
           BEGIN
             INSERT OR REPLACE INTO ${table} (session_id, ${names.join(", ")})
             VALUES (NEW.id, ${names.map((n) => `NEW.${n}`).join(", ")});
           END`
        );
        db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_from_sessions_upd
             AFTER UPDATE OF ${names.join(", ")} ON sessions
             WHEN ${names.map((n) => `NEW.${n} IS NOT OLD.${n}`).join(" OR ")}
           BEGIN
             INSERT INTO ${table} (session_id, ${names.join(", ")})
             VALUES (NEW.id, ${names.map((n) => `NEW.${n}`).join(", ")})
             ON CONFLICT(session_id) DO UPDATE SET
               ${names
                 .map(
                   (n) =>
                     `${n} = CASE WHEN NEW.${n} IS NOT OLD.${n} THEN excluded.${n} ELSE ${table}.${n} END`
                 )
                 .join(",\n               ")};
           END`
        );
        db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_from_sessions_del
             AFTER DELETE ON sessions
           BEGIN
             DELETE FROM ${table} WHERE session_id = OLD.id;
           END`
        );

        for (const [suffix, event] of [
          ["ins", "INSERT"],
          ["upd", "UPDATE"],
          ["del", "DELETE"],
        ])
          db.exec(
            `CREATE TRIGGER IF NOT EXISTS ${table}_bump_sessions_${suffix}
               AFTER ${event} ON ${table}
             BEGIN
               INSERT INTO change_versions (topic, version) VALUES ('sessions', 1)
               ON CONFLICT(topic) DO UPDATE SET version = version + 1;
             END`
          );
      }

      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_session_tasks_status ON session_tasks(task_status)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_session_tasks_moved_from ON session_tasks(moved_from)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_session_tasks_quick_of ON session_tasks(quick_of) WHERE quick_of IS NOT NULL`
      );

      createSessionRowsView(
        db,
        Object.fromEntries(
          Object.entries(PARTS).map(([t, p]) => [t, p.columns.map(([n]) => n)])
        ) as Record<PartTable, string[]>
      );
    })();
  },
} satisfies Migration;
