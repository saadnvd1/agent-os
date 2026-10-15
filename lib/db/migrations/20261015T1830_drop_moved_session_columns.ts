import type { Migration } from "../migration-types";
import type { PartTable } from "../session-parts/columns";
import { createSessionRowsView } from "../session-parts/view";
import { backupDatabase } from "../backup";

// The moved columns as 20261015T1800 split them, frozen here.
const PARTS: Record<PartTable, string[]> = {
  session_tasks: [
    "task_prompt",
    "task_brief",
    "task_status",
    "task_since",
    "task_ended_at",
    "merged_at",
    "priority",
    "quick_of",
    "moved_to",
    "moved_from",
    "model_overrides",
    "lh_card_id",
    "lh_board_id",
    "lh_card_list",
  ],
  session_prs: [
    "pr_url",
    "pr_number",
    "pr_status",
    "merge_armed_at",
    "merge_armed_seen",
    "rebased_from",
    "rebased_to",
    "rebase_asked_head",
    "pr_wake_since",
  ],
  session_plans: [
    "plan_phase",
    "plan_only",
    "plan_decided",
    "plan_reason",
    "plan_note",
    "plan_edits",
    "plan_waits_for_caller",
    "plan_handoff_message",
  ],
  session_placement: [
    "peer_mirror",
    "placed_note",
    "held_by_device",
    "held_from",
    "held_for",
    "held_for_name",
    "started_by_device",
  ],
  session_pauses: ["pause_state", "paused_until", "pause_id", "pause_note"],
};

const hasValue = (prefix: string, column: string) =>
  column === "peer_mirror"
    ? `COALESCE(${prefix}.${column}, 0) != 0`
    : `${prefix}.${column} IS NOT NULL`;

// A value in the part table wins (it is the newer write); one only on
// sessions is carried over.
const carried = (table: string, column: string) =>
  column === "peer_mirror"
    ? `MAX(COALESCE(${table}.${column}, 0), COALESCE(s.${column}, 0))`
    : `COALESCE(${table}.${column}, s.${column})`;

export default {
  key: "20261015T1830_drop_moved_session_columns",
  up: (db) => {
    // The destructive half of the split (docs/decisions/2026-10-15-split-sessions-table.md):
    // the 42 moved columns leave sessions. A full copy of the database comes
    // first, and nothing changes unless it was written. Every value still only
    // on sessions is carried into its table before the columns go.
    const parts = Object.entries(PARTS) as [PartTable, string[]][];
    const remaining = () => {
      const onSessions = new Set(
        (
          db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
        ).map((c) => c.name)
      );
      return parts.flatMap(([, cs]) => cs).filter((c) => onSessions.has(c));
    };
    if (remaining().length === 0) return;

    const sessions = (
      db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }
    ).n;
    // An empty sessions table holds nothing these columns could lose.
    if (sessions > 0) backupDatabase(db, "drop-moved-session-columns");

    // Immediate, and re-read inside: another process opening the same
    // database may have run this between the check and the lock.
    db.transaction(() => {
      const left = remaining();
      if (left.length === 0) return;
      for (const [table, all] of parts) {
        const columns = all.filter((c) => left.includes(c));
        if (columns.length === 0) continue;
        db.exec(
          `INSERT INTO ${table} (session_id, ${columns.join(", ")})
           SELECT s.id, ${columns.map((c) => `s.${c}`).join(", ")}
             FROM sessions s
            WHERE (${columns.map((c) => hasValue("s", c)).join(" OR ")})
              AND NOT EXISTS (SELECT 1 FROM ${table} p WHERE p.session_id = s.id)`
        );
        db.exec(
          `UPDATE ${table} SET
             ${columns.map((c) => `${c} = ${carried(table, c)}`).join(",\n             ")}
             FROM sessions s WHERE s.id = ${table}.session_id`
        );
        db.exec(`DROP TRIGGER IF EXISTS ${table}_from_sessions_ins`);
        db.exec(`DROP TRIGGER IF EXISTS ${table}_from_sessions_upd`);
      }

      // merged_at and task_ended_at are stamped where task_status now lives.
      // A first write of a status inserts the row; a later one updates it.
      db.exec(`DROP TRIGGER IF EXISTS sessions_task_ended_at`);
      db.exec(`DROP TRIGGER IF EXISTS sessions_merged_at`);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS session_tasks_ended_at_upd
          AFTER UPDATE OF task_status ON session_tasks
          WHEN NEW.task_status IN ('dropped', 'done')
            AND OLD.task_status IS NOT NEW.task_status
            AND NEW.task_ended_at IS OLD.task_ended_at
        BEGIN
          UPDATE session_tasks SET task_ended_at = datetime('now')
           WHERE session_id = NEW.session_id;
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS session_tasks_ended_at_ins
          AFTER INSERT ON session_tasks
          WHEN NEW.task_status IN ('dropped', 'done')
            AND NEW.task_ended_at IS NULL
        BEGIN
          UPDATE session_tasks SET task_ended_at = datetime('now')
           WHERE session_id = NEW.session_id;
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS session_tasks_merged_at_upd
          AFTER UPDATE OF task_status ON session_tasks
          WHEN NEW.task_status = 'merged' AND OLD.task_status IS NOT 'merged'
            -- unless the same statement set it (an import keeps its own)
            AND NEW.merged_at IS OLD.merged_at
        BEGIN
          UPDATE session_tasks SET merged_at = datetime('now')
           WHERE session_id = NEW.session_id;
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS session_tasks_merged_at_ins
          AFTER INSERT ON session_tasks
          WHEN NEW.task_status = 'merged' AND NEW.merged_at IS NULL
        BEGIN
          UPDATE session_tasks SET merged_at = datetime('now')
           WHERE session_id = NEW.session_id;
        END
      `);

      db.exec(`DROP VIEW IF EXISTS session_rows`);
      db.exec(`DROP INDEX IF EXISTS idx_sessions_task_status`);
      db.exec(`DROP INDEX IF EXISTS idx_sessions_moved_from`);
      db.exec(`DROP INDEX IF EXISTS idx_sessions_quick_of`);
      for (const column of left)
        db.exec(`ALTER TABLE sessions DROP COLUMN ${column}`);

      createSessionRowsView(db, PARTS);
    }).immediate();
  },
} satisfies Migration;
