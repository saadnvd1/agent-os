import { installChangeTriggers, TABLES_WATCHED_45 } from "./changes";
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
  {
    id: 36,
    name: "add_chat_queue",
    up: (db) => {
      // Messages written while a chat turn runs, sent in order once it ends.
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_queue (
          session_id TEXT NOT NULL,
          id TEXT NOT NULL,
          position REAL NOT NULL,
          text TEXT NOT NULL,
          images TEXT,
          image_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, id)
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_chat_queue_session ON chat_queue(session_id, position)`
      );
      // The agent's guess at the next message, shown in an empty composer.
      db.exec(`ALTER TABLE sessions ADD COLUMN chat_suggestion TEXT`);
    },
  },
  {
    id: 37,
    name: "add_chat_plan_and_turns",
    // One transaction, so a crash part-way leaves nothing to skip as
    // "duplicate column" on the next start.
    up: (db) =>
      db.transaction(() => {
        // Plan mode is remembered per session; the context meter's last
        // reading survives a reload; and the agent's running totals at its
        // last turn tell what the next turn added.
        db.exec(
          `ALTER TABLE sessions ADD COLUMN chat_plan INTEGER NOT NULL DEFAULT 0`
        );
        db.exec(`ALTER TABLE sessions ADD COLUMN chat_context TEXT`);
        db.exec(`ALTER TABLE sessions ADD COLUMN chat_usage TEXT`);
        // What each chat turn cost, kept with the session's name and
        // workspace so the history outlives the session.
        db.exec(`
        CREATE TABLE IF NOT EXISTS chat_turns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          workspace_id TEXT,
          at INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL,
          cache_write_tokens INTEGER NOT NULL
        )
      `);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_chat_turns_at ON chat_turns(at)`
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns(session_id, id)`
        );
      })(),
  },
  {
    id: 38,
    name: "add_schedules",
    up: (db) => {
      // Cron schedules that start agent work, and every run they made or
      // skipped. A run's (schedule, slot) is unique: claiming the row is
      // what stops a slot from running twice. Runs are never deleted, and a
      // removed schedule is archived, not deleted, so its history stays.
      db.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT,
          name TEXT NOT NULL,
          cron TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'America/Chicago',
          prompt TEXT NOT NULL,
          kind TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          armed_at INTEGER NOT NULL,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schedule_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schedule_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          slot_at INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          outcome TEXT NOT NULL,
          detail TEXT,
          session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (schedule_id, slot)
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, id)`
      );
      // Which server process ticks the schedules: one row, renewed each
      // tick, so a second server on the same database never runs them.
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduler_lease (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          owner TEXT NOT NULL,
          pid INTEGER NOT NULL,
          heartbeat INTEGER NOT NULL
        )
      `);
    },
  },
  {
    id: 39,
    name: "add_session_name_source",
    up: (db) => {
      // Who named a session: "user" (typed or given explicitly, never
      // renamed for them), "generated" (a title picked from its prompt) or
      // "default" ("Session 4", or a placeholder until a title arrives).
      // One transaction, so a crash part-way leaves nothing to skip.
      db.transaction(() => {
        db.exec(
          `ALTER TABLE sessions ADD COLUMN name_source TEXT NOT NULL DEFAULT 'default'`
        );
        // A session renamed by hand before this keeps its name.
        db.exec(
          `UPDATE sessions SET name_source = 'user' WHERE id IN (SELECT session_id FROM session_names)`
        );
      })();
    },
  },
  {
    id: 40,
    name: "add_schedule_targets_and_phone_notify",
    // One transaction, so a crash part-way leaves nothing to skip as
    // "duplicate column" on the next start.
    up: (db) =>
      db.transaction(() => {
        // Where phone notifications go. One row; the bot token is never
        // returned by any route or written to a log.
        db.exec(`
          CREATE TABLE IF NOT EXISTS notify_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            telegram_token TEXT,
            telegram_chat_id TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        // Every phone notification, sent or waiting out its source's
        // minute, so one held across a restart still goes.
        db.exec(`
          CREATE TABLE IF NOT EXISTS notify_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            send_after INTEGER NOT NULL,
            sent_at INTEGER,
            error TEXT
          )
        `);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_notify_outbox_source ON notify_outbox(source, sent_at)`
        );
        // A "message" schedule's session, by id: names change, ids don't.
        // And the agent session that made a schedule, when one did.
        db.exec(`ALTER TABLE schedules ADD COLUMN target_session_id TEXT`);
        db.exec(`ALTER TABLE schedules ADD COLUMN created_by_session_id TEXT`);
      })(),
  },
  {
    id: 41,
    name: "add_task_setup",
    up: (db) => {
      // How a task's worktree setup (deps, setup commands) went before its
      // agent started: running, ok or failed, how long, and what failed;
      // and the brief its launch needs, so a restart can resume it.
      db.transaction(() => {
        db.exec(`ALTER TABLE sessions ADD COLUMN setup_status TEXT`);
        db.exec(`ALTER TABLE sessions ADD COLUMN setup_ms INTEGER`);
        db.exec(`ALTER TABLE sessions ADD COLUMN setup_error TEXT`);
        db.exec(`ALTER TABLE sessions ADD COLUMN task_brief TEXT`);
      })();
    },
  },
  {
    id: 42,
    name: "add_host_links_and_moved_tasks",
    up: (db) => {
      // How this machine reaches another machine's own AgentOS: its URL and
      // the device token it paired with. Apart from hosts so the token never
      // rides along with a host row to the browser.
      db.transaction(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS host_links (
            host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            token TEXT NOT NULL,
            linked_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        // A task moved to another machine keeps its row, marked where it
        // went; one that arrived names the session it came from, so the
        // same move imported twice finds the first.
        db.exec(`ALTER TABLE sessions ADD COLUMN moved_to TEXT`);
        db.exec(`ALTER TABLE sessions ADD COLUMN moved_from TEXT`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_sessions_moved_from ON sessions(moved_from)`
        );
      })();
    },
  },
  {
    id: 43,
    name: "scratch_project",
    up: (db) => {
      // Chats with no project work in a scratch folder rather than the home
      // directory. Sessions already made keep their own folders.
      db.prepare(
        `UPDATE projects SET name = 'Scratch', working_directory = '~/.agent-os/scratch'
         WHERE is_uncategorized = 1 AND name = 'Uncategorized' AND working_directory = '~'`
      ).run();
    },
  },
  {
    id: 44,
    name: "chat_item_kind",
    up: (db) => {
      // Items of one kind (a chat's background tasks, its sent messages)
      // read from an index, not by parsing every row of a long conversation.
      const columns = db.prepare(`PRAGMA table_xinfo(chat_items)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "kind"))
        db.exec(
          `ALTER TABLE chat_items ADD COLUMN kind TEXT
             GENERATED ALWAYS AS (json_extract(data, '$.kind')) VIRTUAL`
        );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_chat_items_kind ON chat_items(session_id, kind, seq)`
      );
    },
  },
  {
    id: 45,
    name: "change_versions",
    up: (db) => {
      // What browsers show from these tables is pushed when they change
      // (lib/db/changes.ts) instead of polled. A table added later gets its
      // own migration.
      installChangeTriggers(db, TABLES_WATCHED_45);
    },
  },
  {
    id: 46,
    name: "session_port_slots",
    up: (db) => {
      // A session's port slot and the ports agentos.json's bases resolve to
      // with it (lib/ports.ts). The unique index is what keeps two parallel
      // starts, in any process, off one slot.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "port_slot"))
        db.exec(`ALTER TABLE sessions ADD COLUMN port_slot INTEGER`);
      if (!columns.some((c) => c.name === "ports"))
        db.exec(`ALTER TABLE sessions ADD COLUMN ports TEXT`);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_port_slot ON sessions(port_slot) WHERE port_slot IS NOT NULL`
      );
    },
  },
  {
    id: 47,
    name: "pin_orchestrators",
    up: (db) => {
      // A workspace's orchestrator starts pinned to the top of its list;
      // unpinning it is then remembered on the session, which lives as
      // long as its workspace.
      db.exec(`UPDATE sessions SET pinned = 1 WHERE role = 'orchestrator'`);
    },
  },
  {
    id: 48,
    name: "session_database",
    up: (db) => {
      // The session's private Postgres copy, or why it has none, as JSON
      // (lib/project-config/database.ts).
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "database"))
        db.exec(`ALTER TABLE sessions ADD COLUMN database TEXT`);
    },
  },
  {
    id: 49,
    name: "peer_mirror",
    up: (db) => {
      // A row that only shows a linked machine's own session: actions on
      // it go to that machine. Rows this machine started there over ssh
      // are its own, and stay 0.
      db.exec(
        `ALTER TABLE sessions ADD COLUMN peer_mirror INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
];

// `upTo`: stop after this id (tests that start from an older database).
export function runMigrations(
  db: Database.Database,
  upTo = Number.POSITIVE_INFINITY
): void {
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
    if (applied.has(migration.id) || migration.id > upTo) continue;

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
