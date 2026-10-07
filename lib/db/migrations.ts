import type Database from "better-sqlite3";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

// All migrations in order - never modify existing ones, only add new
const migrations: Migration[] = [
  {
    id: 1,
    name: "add_group_path_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN group_path TEXT NOT NULL DEFAULT 'sessions'`
      );
    },
  },
  {
    id: 2,
    name: "add_agent_type_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude'`
      );
    },
  },
  {
    id: 3,
    name: "add_worktree_columns_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN worktree_path TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN branch_name TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN base_branch TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN dev_server_port INTEGER`);
    },
  },
  {
    id: 4,
    name: "add_pr_tracking_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_url TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_number INTEGER`);
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_status TEXT`);
    },
  },
  {
    id: 5,
    name: "add_group_path_index",
    up: (db) => {
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_path)`
      );
    },
  },
  {
    id: 6,
    name: "add_orchestration_columns_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN conductor_session_id TEXT REFERENCES sessions(id)`
      );
      db.exec(`ALTER TABLE sessions ADD COLUMN worker_task TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN worker_status TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_conductor ON sessions(conductor_session_id)`
      );
    },
  },
  {
    id: 7,
    name: "add_auto_approve_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
  {
    id: 8,
    name: "add_dev_server_columns",
    up: (db) => {
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN type TEXT NOT NULL DEFAULT 'node'`
      );
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN name TEXT NOT NULL DEFAULT ''`
      );
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN command TEXT NOT NULL DEFAULT ''`
      );
      db.exec(`ALTER TABLE dev_servers ADD COLUMN pid INTEGER`);
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''`
      );
    },
  },
  {
    id: 9,
    name: "add_project_id_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`
      );
      db.exec(
        `UPDATE sessions SET project_id = 'uncategorized' WHERE project_id IS NULL`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`
      );
    },
  },
  {
    id: 10,
    name: "add_project_id_to_dev_servers",
    up: (db) => {
      // Check if column exists first
      const cols = db.prepare(`PRAGMA table_info(dev_servers)`).all() as {
        name: string;
      }[];
      if (cols.some((c) => c.name === "project_id")) return;

      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN project_id TEXT REFERENCES projects(id)`
      );
      // Migrate from session_id if it exists
      const hasSessionId = cols.some((c) => c.name === "session_id");
      if (hasSessionId) {
        db.exec(`
          UPDATE dev_servers
          SET project_id = (
            SELECT COALESCE(s.project_id, 'uncategorized')
            FROM sessions s
            WHERE s.id = dev_servers.session_id
          )
          WHERE project_id IS NULL
        `);
      }
      db.exec(
        `UPDATE dev_servers SET project_id = 'uncategorized' WHERE project_id IS NULL`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_dev_servers_project ON dev_servers(project_id)`
      );
    },
  },
  {
    id: 11,
    name: "add_tmux_name_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN tmux_name TEXT`);
      // Backfill existing sessions with computed tmux name
      db.exec(
        `UPDATE sessions SET tmux_name = agent_type || '-' || id WHERE tmux_name IS NULL`
      );
    },
  },
  {
    id: 12,
    name: "add_initial_prompt_to_projects",
    up: (db) => {
      db.exec(`ALTER TABLE projects ADD COLUMN initial_prompt TEXT`);
    },
  },
  {
    id: 13,
    name: "add_project_repositories_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_repositories (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_project_repositories_project ON project_repositories(project_id)`
      );
    },
  },
  {
    id: 14,
    name: "add_hosts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hosts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          ssh_target TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(
        `ALTER TABLE projects ADD COLUMN host_id TEXT NOT NULL DEFAULT 'local'`
      );
      db.exec(
        `ALTER TABLE sessions ADD COLUMN host_id TEXT NOT NULL DEFAULT 'local'`
      );
    },
  },
  {
    id: 15,
    name: "add_workspaces",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          collapsed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`ALTER TABLE projects ADD COLUMN workspace_id TEXT`);
    },
  },
  {
    id: 16,
    name: "add_task_columns_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN task_prompt TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN task_status TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_task_status ON sessions(task_status)`
      );
    },
  },
  {
    id: 17,
    name: "add_bus_messages",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bus_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_id TEXT,
          from_name TEXT NOT NULL,
          to_id TEXT NOT NULL,
          to_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          delivered_at TEXT,
          read_at TEXT
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_bus_to ON bus_messages(to_id, read_at)`
      );
    },
  },
  {
    id: 18,
    name: "add_chat",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN view TEXT NOT NULL DEFAULT 'terminal'`
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_items (
          session_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (session_id, item_id)
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_chat_items_seq ON chat_items(session_id, seq)`
      );
    },
  },
  {
    id: 19,
    name: "add_lumifyhub",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lumifyhub_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          base_url TEXT NOT NULL,
          token TEXT NOT NULL,
          user_id TEXT,
          user_email TEXT,
          user_name TEXT,
          connected_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS lumifyhub_connect_attempts (
          state TEXT PRIMARY KEY,
          verifier TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`ALTER TABLE workspaces ADD COLUMN lh_workspace_id TEXT`);
      db.exec(`ALTER TABLE workspaces ADD COLUMN lh_workspace_slug TEXT`);
      db.exec(`ALTER TABLE workspaces ADD COLUMN lh_workspace_name TEXT`);
      db.exec(`ALTER TABLE projects ADD COLUMN lh_board_id TEXT`);
      db.exec(`ALTER TABLE projects ADD COLUMN lh_board_name TEXT`);
      db.exec(`ALTER TABLE projects ADD COLUMN lh_board_page_id TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN lh_card_id TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN lh_board_id TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN lh_card_list TEXT`);
    },
  },
  {
    id: 20,
    name: "add_lumifyhub_published_docs",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lumifyhub_published_docs (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          repo_path TEXT NOT NULL,
          page_id TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          published_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, repo_path)
        )
      `);
    },
  },
  {
    id: 21,
    name: "add_chat_access",
    up: (db) => {
      // What a chat agent may do without asking; full is the old behavior.
      db.exec(
        `ALTER TABLE sessions ADD COLUMN chat_access TEXT NOT NULL DEFAULT 'full'`
      );
      // After an undo, where the next start resumes the conversation from.
      db.exec(`ALTER TABLE sessions ADD COLUMN chat_resume_at TEXT`);
    },
  },
  {
    id: 22,
    name: "add_last_seen",
    up: (db) => {
      // When the reader last looked, so "needs you" means something new.
      db.exec(`ALTER TABLE sessions ADD COLUMN last_seen_at TEXT`);
    },
  },
  {
    id: 23,
    name: "mark_existing_sessions_seen",
    up: (db) => {
      // Start quiet: what finished before "needs you" meant news is old news.
      db.exec(
        `UPDATE sessions SET last_seen_at = datetime('now') WHERE last_seen_at IS NULL`
      );
    },
  },
  {
    id: 24,
    name: "add_stacks",
    up: (db) => {
      // A LumifyHub board's cards run as stacked tasks (lib/stacks).
      db.exec(`
        CREATE TABLE IF NOT EXISTS stacks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          lh_board_id TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          max_parallel INTEGER NOT NULL DEFAULT 3,
          progress TEXT,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          landed_at TEXT
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS stack_items (
          id TEXT PRIMARY KEY,
          stack_id TEXT NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          lh_card_id TEXT NOT NULL,
          ticket TEXT,
          title TEXT NOT NULL,
          parent_item_id TEXT,
          also_item_ids TEXT NOT NULL DEFAULT '[]',
          blocker_item_ids TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'planned',
          session_id TEXT,
          base_branch TEXT,
          base_tip TEXT,
          pr_number INTEGER,
          note TEXT,
          error TEXT
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stack_items_stack ON stack_items(stack_id, position)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stack_items_session ON stack_items(session_id)`
      );
    },
  },
  {
    id: 25,
    name: "add_stack_item_attempts",
    up: (db) => {
      // Starts retried after a transient failure, and holds the plan made
      // (an open blocker outside the stack) that a retry must not undo.
      db.exec(
        `ALTER TABLE stack_items ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`
      );
      db.exec(
        `ALTER TABLE stack_items ADD COLUMN held_outside INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
  {
    id: 26,
    name: "add_workspace_orchestrator",
    up: (db) => {
      // One standing orchestrator chat per workspace. Its events are kept
      // by key: a key present means that event is known, delivered or
      // queued. An event is sent once seen on two diffs in a row (hits);
      // a passing one that cleared is remembered (cleared_at) so it can't
      // fire again too soon. The log counts deliveries per subject.
      db.exec(`ALTER TABLE sessions ADD COLUMN role TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN workspace_id TEXT`);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_orchestrator
         ON sessions(workspace_id) WHERE role = 'orchestrator'`
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          key TEXT NOT NULL,
          subject TEXT,
          line TEXT NOT NULL,
          sticky INTEGER NOT NULL DEFAULT 1,
          low INTEGER NOT NULL DEFAULT 0,
          hits INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          delivered_at TEXT,
          cleared_at TEXT,
          UNIQUE (workspace_id, key)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_event_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          subject TEXT,
          delivered_at TEXT NOT NULL
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_orchestrator_event_log
         ON orchestrator_event_log(workspace_id, delivered_at)`
      );
    },
  },
  {
    id: 27,
    name: "add_devices_and_settings",
    up: (db) => {
      // Paired phones, tablets and laptops. Only a hash of each token is kept.
      db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT,
          last_address TEXT,
          revoked_at TEXT
        )
      `);
      // Small app-wide switches (Wi-Fi access, pairing on the tailnet).
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    },
  },
  {
    id: 28,
    name: "add_orchestrator_acting",
    up: (db) => {
      // The orchestrator's brakes (settings per workspace, and the brake in
      // force so it's noted once), its starts, its decision log, the reviews
      // and scope checks it ran per commit, and gate failures per task.
      db.exec(
        `ALTER TABLE workspaces ADD COLUMN orch_max_running INTEGER NOT NULL DEFAULT 4`
      );
      db.exec(
        `ALTER TABLE workspaces ADD COLUMN orch_max_starts_per_hour INTEGER NOT NULL DEFAULT 6`
      );
      db.exec(`ALTER TABLE workspaces ADD COLUMN orch_brake TEXT`);
      // The secret an orchestrator's worker sends with each tool call.
      db.exec(`ALTER TABLE sessions ADD COLUMN orch_token TEXT`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_starts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          target TEXT,
          created_at TEXT NOT NULL
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_orchestrator_starts
         ON orchestrator_starts(workspace_id, created_at)`
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'note',
          text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_orchestrator_notes
         ON orchestrator_notes(workspace_id, id)`
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          sha TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (session_id, sha, kind)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_gate_failures (
          session_id TEXT NOT NULL,
          gate TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          last_reason TEXT,
          escalated_at TEXT,
          PRIMARY KEY (session_id, gate)
        )
      `);
    },
  },
  {
    id: 29,
    name: "add_orchestrator_asks_and_pause",
    up: (db) => {
      // Items the orchestrator parks for Saad. One open ask per subject (a
      // task, the brakes, a title it raised), so a repeat escalation updates
      // it instead of adding another. An approval of a gate or brake ask is
      // spent once (used_at), on the commit it was asked about (sha).
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_asks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          link TEXT,
          sha TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          answer TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT,
          used_at TEXT,
          brake_key TEXT
        )
      `);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_asks_open
         ON orchestrator_asks(workspace_id, subject) WHERE status = 'open'`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_orchestrator_asks_workspace
         ON orchestrator_asks(workspace_id, status)`
      );
      // While set, the orchestrator acts on nothing: events queue and its
      // acting tools refuse.
      db.exec(`ALTER TABLE workspaces ADD COLUMN orch_paused_at TEXT`);
      // Proof a person approves: a paired device may answer asks only once
      // Saad lets it, and approvals that matter need a passkey assertion
      // (user verification) on a challenge bound to the one item.
      db.exec(
        `ALTER TABLE devices ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 0`
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS passkeys (
          id TEXT PRIMARY KEY,
          public_key BLOB NOT NULL,
          counter INTEGER NOT NULL DEFAULT 0,
          transports TEXT,
          rp_id TEXT NOT NULL,
          name TEXT NOT NULL,
          registered_via TEXT,
          registered_from TEXT,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          revoked_at TEXT
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS presence_challenges (
          challenge TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          purpose TEXT NOT NULL,
          binding TEXT NOT NULL,
          rp_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS passkey_enrollments (
          code_hash TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          used_at INTEGER
        )
      `);
    },
  },
  {
    id: 30,
    name: "add_sessions_archived_at",
    up: (db) => {
      // Done sessions leave the sidebar but are never deleted, so their
      // history and chat items stay.
      db.exec(`ALTER TABLE sessions ADD COLUMN archived_at TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at)`
      );
    },
  },
  {
    id: 31,
    name: "add_stack_item_restacked_heads",
    up: (db) => {
      // A branch AgentOS rebased itself: its head before (the commit the
      // task's code review covered) and after (the head AgentOS pushed).
      // Each column checked, so a run cut off between the two can't be
      // marked applied with one missing.
      const cols = new Set(
        (
          db.prepare(`PRAGMA table_info(stack_items)`).all() as {
            name: string;
          }[]
        ).map((c) => c.name)
      );
      for (const col of ["restacked_from", "restacked_to"])
        if (!cols.has(col))
          db.exec(`ALTER TABLE stack_items ADD COLUMN ${col} TEXT`);
    },
  },
  {
    id: 32,
    name: "add_sessions_pinned",
    up: (db) => {
      // Pinned sessions sit on their own shelf at the top of the sidebar.
      db.exec(
        `ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
  {
    id: 33,
    name: "add_program_status",
    up: (db) => {
      // What programs in a terminal report about themselves (OSC 7501),
      // by tmux session: kept so a restart doesn't forget a finished or
      // blocked session.
      db.exec(`
        CREATE TABLE IF NOT EXISTS program_status (
          session_name TEXT PRIMARY KEY,
          records TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: 34,
    name: "add_session_names",
    up: (db) => {
      // Names a session had before it was renamed, so a message sent to
      // an old name still reaches it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_names (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          name TEXT NOT NULL,
          renamed_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_session_names_session ON session_names(session_id)`
      );
    },
  },
  {
    id: 35,
    name: "add_artifacts",
    up: (db) => {
      // Pages a chat agent showed with html_render. The HTML lives in a file
      // under ~/.agent-os/artifacts; the row says whose it is and what it's
      // called.
      db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id, created_at)`
      );
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map(
      (r) => r.id
    )
  );

  // Use INSERT OR IGNORE to handle concurrent workers
  const insertMigration = db.prepare(
    `INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)`
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    try {
      migration.up(db);
      const result = insertMigration.run(migration.id, migration.name);
      if (result.changes > 0) {
        console.log(`Migration ${migration.id}: ${migration.name} applied`);
      } else {
        console.log(
          `Migration ${migration.id}: ${migration.name} skipped (concurrent apply)`
        );
      }
    } catch (error) {
      // Some migrations may fail if columns already exist (from old system or concurrent worker)
      // Try to record as applied anyway to prevent re-running
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes("duplicate column") ||
        errorMsg.includes("already exists")
      ) {
        insertMigration.run(migration.id, migration.name);
        console.log(
          `Migration ${migration.id}: ${migration.name} skipped (already applied)`
        );
      } else {
        console.error(
          `Migration ${migration.id}: ${migration.name} failed:`,
          error
        );
        throw error;
      }
    }
  }
}
