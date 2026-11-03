import type Database from "better-sqlite3";
import type { Migration } from "../migration-types";
import { createSessionRowsView } from "../session-parts/view";
import { backupDatabase } from "../backup";

const LEAD_TABLES = [
  "lead_adoptions",
  "lead_areas",
  "lead_charters",
  "lead_direction",
  "lead_held_mail",
  "lead_memos",
  "lead_messages",
  "lead_pin_proposals",
  "workspace_leads",
];
const SESSION_COLUMNS = ["lead_kind", "lead_since", "started_by_lead"];
const LOG_TABLES = ["orchestrator_notes", "orchestrator_asks"];

const tableExists = (db: Database.Database, name: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);

const columnsOf = (db: Database.Database, table: string): string[] =>
  tableExists(db, table)
    ? (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name)
    : [];

const leftovers = (db: Database.Database) => [
  ...LEAD_TABLES.filter((t) => tableExists(db, t)),
  ...SESSION_COLUMNS.filter((c) => columnsOf(db, "sessions").includes(c)),
  ...LOG_TABLES.filter((t) => columnsOf(db, t).includes("lead_kind")),
];

// Empty lead tables and columns (what the lead migrations leave on a
// workspace that never used leads) hold nothing worth a copy.
function hasLeadData(db: Database.Database): boolean {
  if (
    LEAD_TABLES.some(
      (t) =>
        tableExists(db, t) && db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get()
    )
  )
    return true;
  const cols = columnsOf(db, "sessions");
  const marks = [
    ...(cols.includes("role") ? [`role IN ('lead', 'chief')`] : []),
    ...SESSION_COLUMNS.filter((c) => cols.includes(c)).map(
      (c) => `${c} IS NOT NULL`
    ),
  ];
  if (
    marks.length &&
    db
      .prepare(`SELECT 1 FROM sessions WHERE ${marks.join(" OR ")} LIMIT 1`)
      .get()
  )
    return true;
  return LOG_TABLES.some(
    (t) =>
      columnsOf(db, t).includes("lead_kind") &&
      db.prepare(`SELECT 1 FROM ${t} WHERE lead_kind <> 'tech' LIMIT 1`).get()
  );
}

function renameTo(db: Database.Database, id: string, name: string) {
  const current = db
    .prepare(`SELECT name FROM sessions WHERE id = ?`)
    .get(id) as { name: string } | undefined;
  if (!current || current.name === name) return;
  db.prepare(`INSERT INTO session_names (session_id, name) VALUES (?, ?)`).run(
    id,
    current.name
  );
  db.prepare(`UPDATE sessions SET name = ? WHERE id = ?`).run(name, id);
}

export default {
  key: "20261103T0200_remove_leads",
  up: (db) => {
    // The Leads experiment is gone (docs/decisions/2026-11-03-remove-leads.md).
    // Safe on a database that never had leads: every step looks first. A full
    // copy comes before anything is dropped, and a failed copy stops it.
    if (leftovers(db).length === 0) {
      db.prepare(`DELETE FROM settings WHERE key = 'experiments.leads'`).run();
      return;
    }
    if (hasLeadData(db)) backupDatabase(db, "remove-leads");

    db.transaction(() => {
      if (leftovers(db).length === 0) return;
      const cols = columnsOf(db, "sessions");
      const hasRole = cols.includes("role");
      const adopted = tableExists(db, "lead_adoptions")
        ? (db
            .prepare(`SELECT session_id, adopted_at FROM lead_adoptions`)
            .all() as { session_id: string; adopted_at: string }[])
        : [];
      const adoptedIds = new Set(adopted.map((a) => a.session_id));
      // Sessions made as leads: the chief and any lead AgentOS created.
      const created = hasRole
        ? (
            db
              .prepare(
                `SELECT id FROM sessions WHERE role IN ('lead', 'chief')`
              )
              .all() as { id: string }[]
          )
            .map((r) => r.id)
            .filter((id) => !adoptedIds.has(id))
        : [];

      db.exec(`DROP INDEX IF EXISTS idx_sessions_lead`);
      db.exec(`DROP INDEX IF EXISTS idx_sessions_chief`);

      // An adopted chat goes back to what it was called when it was adopted,
      // as a plain session; its project, history and place are untouched.
      const wasNamed = db.prepare(
        `SELECT name FROM session_names WHERE session_id = ? AND renamed_at <= ?
          ORDER BY id DESC LIMIT 1`
      );
      for (const a of adopted) {
        if (
          !db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(a.session_id)
        )
          continue;
        const was = wasNamed.get(a.session_id, a.adopted_at) as
          { name: string } | undefined;
        if (was) renameTo(db, a.session_id, was.name);
        db.prepare(
          `UPDATE sessions SET role = NULL, workspace_id = NULL, orch_token = NULL
            WHERE id = ? AND role = 'lead'`
        ).run(a.session_id);
      }

      // A session made as a lead is archived, so its transcript stays.
      for (const id of created) {
        db.prepare(
          `UPDATE sessions SET role = NULL, workspace_id = NULL, orch_token = NULL,
             pinned = 0, archived_at = COALESCE(archived_at, datetime('now'))
           WHERE id = ?`
        ).run(id);
        if (columnsOf(db, "schedules").includes("target_session_id"))
          db.prepare(
            `UPDATE schedules SET enabled = 0,
               archived_at = COALESCE(archived_at, datetime('now'))
             WHERE target_session_id = ?`
          ).run(id);
        db.prepare(`DELETE FROM needs_you_dismissed WHERE key = ?`).run(
          `approval:${id}`
        );
      }

      // "<workspace> Tech lead" is "<workspace> orchestrator" again.
      if (hasRole && tableExists(db, "workspaces")) {
        const tech = cols.includes("lead_kind")
          ? ` OR s.lead_kind IS NOT NULL`
          : "";
        const rows = db
          .prepare(
            `SELECT s.id, w.name AS workspace FROM sessions s
               JOIN workspaces w ON w.id = s.workspace_id
              WHERE s.role = 'orchestrator'
                AND (s.name = w.name || ' Tech lead'${tech})`
          )
          .all() as { id: string; workspace: string }[];
        for (const r of rows) renameTo(db, r.id, `${r.workspace} orchestrator`);
      }

      // The Needs-you "waiting in chat" dismissal was keyed by session.
      if (hasRole && tableExists(db, "needs_you_dismissed")) {
        db.exec(`
          UPDATE OR IGNORE needs_you_dismissed
             SET key = 'approval:' || workspace_id
           WHERE key = 'approval:' || (
             SELECT s.id FROM sessions s
              WHERE s.role = 'orchestrator'
                AND s.workspace_id = needs_you_dismissed.workspace_id)
        `);
        db.exec(`
          DELETE FROM needs_you_dismissed
           WHERE key = 'approval:' || (
             SELECT s.id FROM sessions s
              WHERE s.role = 'orchestrator'
                AND s.workspace_id = needs_you_dismissed.workspace_id)
        `);
      }

      // Notes and asks written by the chief or a lead are not the
      // orchestrator's; the copy above has them.
      for (const table of LOG_TABLES)
        if (columnsOf(db, table).includes("lead_kind"))
          db.exec(`DELETE FROM ${table} WHERE lead_kind <> 'tech'`);

      db.exec(`DROP VIEW IF EXISTS session_rows`);
      for (const table of LEAD_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
      for (const c of SESSION_COLUMNS)
        if (columnsOf(db, "sessions").includes(c))
          db.exec(`ALTER TABLE sessions DROP COLUMN ${c}`);
      for (const table of LOG_TABLES)
        if (columnsOf(db, table).includes("lead_kind"))
          db.exec(`ALTER TABLE ${table} DROP COLUMN lead_kind`);
      createSessionRowsView(db);
      db.prepare(`DELETE FROM settings WHERE key = 'experiments.leads'`).run();
    }).immediate();
  },
} satisfies Migration;
