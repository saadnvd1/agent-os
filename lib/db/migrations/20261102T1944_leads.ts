import type { Migration } from "../migration-types";
import { createSessionRowsView } from "../session-parts/view";

const columnsOf = (db: Parameters<Migration["up"]>[0], table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );

export default {
  key: "20261102T1944_leads",
  up: (db) => {
    // Leads (lib/leads): a lead is a standing chat like the orchestrator,
    // with role 'lead' and a lead_kind; the orchestrator is the 'tech' lead
    // once its workspace adds leads, and a workspace has one 'chief'.
    // lead_since is when it became one, so its usage counts from then.
    // Additive: a workspace without leads has none of these rows.
    const sessions = columnsOf(db, "sessions");
    if (!sessions.includes("lead_kind"))
      db.exec(`ALTER TABLE sessions ADD COLUMN lead_kind TEXT`);
    if (!sessions.includes("lead_since"))
      db.exec(`ALTER TABLE sessions ADD COLUMN lead_since TEXT`);
    createSessionRowsView(db);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_lead
         ON sessions(workspace_id, lead_kind) WHERE role = 'lead'`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_chief
         ON sessions(workspace_id) WHERE role = 'chief'`
    );

    // A row means the workspace added leads. The chief's autonomy starts at
    // acting only when asked; a later setting lifts it without code.
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_leads (
        workspace_id TEXT PRIMARY KEY,
        enabled_at TEXT NOT NULL DEFAULT (datetime('now')),
        chief_autonomy TEXT NOT NULL DEFAULT 'on_request'
          CHECK (chief_autonomy IN ('on_request', 'acts'))
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_charters (
        workspace_id TEXT NOT NULL,
        lead_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        area_text TEXT NOT NULL DEFAULT '',
        charter_md TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (workspace_id, lead_kind)
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_areas (
        workspace_id TEXT NOT NULL,
        lead_kind TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('project', 'path', 'board')),
        value TEXT NOT NULL,
        PRIMARY KEY (workspace_id, lead_kind, kind, value)
      )
    `);
    // Pinned direction quotes a chat item the person wrote; a newer pin
    // supersedes an older one and nothing is deleted.
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_direction (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        lead_kind TEXT NOT NULL,
        session_id TEXT NOT NULL,
        chat_item_id TEXT NOT NULL,
        quote TEXT NOT NULL,
        set_at TEXT NOT NULL DEFAULT (datetime('now')),
        superseded_by INTEGER
      )
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_lead_direction
         ON lead_direction(workspace_id, lead_kind, id)`
    );
    // Proposed pins (an adopted lead's, or a lead's suggestion) wait here
    // until the person confirms or drops them.
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_pin_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        lead_kind TEXT NOT NULL,
        session_id TEXT NOT NULL,
        chat_item_id TEXT NOT NULL,
        quote TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'pinned', 'dropped')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      )
    `);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_pin_proposals_open
         ON lead_pin_proposals(session_id, chat_item_id) WHERE status = 'open'`
    );
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_memos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        lead_kind TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_lead_memos
         ON lead_memos(workspace_id, lead_kind, id)`
    );
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        from_kind TEXT NOT NULL,
        to_kind TEXT NOT NULL,
        thread TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        read_at TEXT
      )
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_lead_messages_to
         ON lead_messages(workspace_id, to_kind, id)`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_lead_messages_thread
         ON lead_messages(workspace_id, thread, id)`
    );

    // The decision log and asks per lead; every existing row is Tech's.
    for (const table of ["orchestrator_notes", "orchestrator_asks"])
      if (!columnsOf(db, table).includes("lead_kind"))
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN lead_kind TEXT NOT NULL DEFAULT 'tech'`
        );
  },
} satisfies Migration;
