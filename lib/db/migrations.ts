import {
  installChangeTriggers,
  TABLES_WATCHED_45,
  TABLES_WATCHED_50,
  TABLES_WATCHED_56,
  TABLES_WATCHED_58,
  TABLES_WATCHED_78,
  TABLES_WATCHED_80,
} from "./changes";
import type Database from "better-sqlite3";
import { moveSchedulesToRecipes } from "./schedules-move";

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
  {
    id: 50,
    name: "task_queue",
    up: (db) => {
      // Tasks waiting to start (lib/tasks/queue.ts): over the workspace's
      // limit on running tasks, or after another task. A row's id is the
      // session id it starts as, so a restart never starts one twice.
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_queue (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          name TEXT,
          model TEXT,
          view TEXT,
          base_branch TEXT,
          host_id TEXT,
          after_task TEXT,
          after_any TEXT,
          origin_workspace_id TEXT,
          position INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          note TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          started_at TEXT
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status, position)`
      );
      const columns = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
        name: string;
      }[];
      // Null: no limit.
      if (!columns.some((c) => c.name === "max_running_tasks"))
        db.exec(`ALTER TABLE workspaces ADD COLUMN max_running_tasks INTEGER`);
      installChangeTriggers(db, TABLES_WATCHED_50);
    },
  },
  {
    // 50 is taken by queued tasks, landing separately.
    id: 51,
    name: "chat_queue_sent_by",
    up: (db) => {
      // Who sent a queued message the reader didn't type (lib/chat/events
      // SentBy, as JSON), so it still shows as theirs once it's sent.
      const columns = db.prepare(`PRAGMA table_info(chat_queue)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "sent_by"))
        db.exec(`ALTER TABLE chat_queue ADD COLUMN sent_by TEXT`);
    },
  },
  {
    id: 52,
    name: "sessions_chat_restarted",
    up: (db) => {
      // Set by a chat worker that retired cleanly after a deploy; the next
      // worker tells the agent so with its first message, then clears it.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "chat_restarted"))
        db.exec(
          `ALTER TABLE sessions ADD COLUMN chat_restarted INTEGER NOT NULL DEFAULT 0`
        );
    },
  },
  {
    id: 53,
    name: "brief_amendments_failure_sha_ask_raised_by",
    up: (db) => {
      // Scope changes the orchestrator records on a task after it started
      // (send with scope_change); its review judges against them.
      db.exec(`
        CREATE TABLE IF NOT EXISTS brief_amendments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_brief_amendments_session
          ON brief_amendments(session_id);
      `);
      // The commit a stored verdict's failure was counted for, so reading
      // the same verdict again isn't a second failure.
      const columns = db
        .prepare(`PRAGMA table_info(orchestrator_gate_failures)`)
        .all() as { name: string }[];
      if (!columns.some((c) => c.name === "last_sha"))
        db.exec(
          `ALTER TABLE orchestrator_gate_failures ADD COLUMN last_sha TEXT`
        );
      // Who raised a merge ask: the orchestrator may refresh its own, never
      // one the gates raised.
      const asks = db.prepare(`PRAGMA table_info(orchestrator_asks)`).all() as {
        name: string;
      }[];
      if (!asks.some((c) => c.name === "raised_by"))
        db.exec(`ALTER TABLE orchestrator_asks ADD COLUMN raised_by TEXT`);
    },
  },
  {
    id: 54,
    name: "sessions_chat_tools_digest",
    up: (db) => {
      // The tools a chat worker last gave the agent (an orchestrator's), so
      // the next one says they changed only when they did.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "chat_tools_digest"))
        db.exec(`ALTER TABLE sessions ADD COLUMN chat_tools_digest TEXT`);
    },
  },
  {
    id: 55,
    name: "sessions_merge_armed_and_rebase",
    up: (db) => {
      // merge_armed_at: AgentOS merges the task's PR once every gate
      // passes (orchestrator/armed.ts); merge_armed_seen: the failure it
      // last reported. rebased_from/to: the heads an automatic rebase onto
      // the base moved the branch between, for the code-review gate.
      // rebase_asked_head: the head the task was last asked to rebase.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      for (const name of [
        "merge_armed_at",
        "merge_armed_seen",
        "rebased_from",
        "rebased_to",
        "rebase_asked_head",
      ])
        if (!columns.some((c) => c.name === name))
          db.exec(`ALTER TABLE sessions ADD COLUMN ${name} TEXT`);
    },
  },
  {
    id: 56,
    name: "orchestrator_rules",
    up: (db) => {
      // Standing rules an orchestrator keeps across fresh starts
      // (lib/orchestrator/rules.ts): written by it or by Saad, never
      // deleted, only marked removed.
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          added_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          removed_at TEXT,
          removed_by TEXT
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_orchestrator_rules
         ON orchestrator_rules(workspace_id, removed_at, id)`
      );
      // Its last worker ended the conversation at the context threshold:
      // the tokens it had reached (0 otherwise). The next one starts a new
      // one and tells the agent so.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "chat_refreshed"))
        db.exec(
          `ALTER TABLE sessions ADD COLUMN chat_refreshed INTEGER NOT NULL DEFAULT 0`
        );
      installChangeTriggers(db, TABLES_WATCHED_56);
    },
  },
  {
    id: 57,
    name: "task_pr_wakes",
    up: (db) => {
      // What a task's agent was told about its PR (orchestrator/pr-wake.ts),
      // one row per failing head or review/comment id, claimed before the
      // message goes. kind: check, review or comment (comments are capped).
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_pr_wakes (
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          kind TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, key)
        );
      `);
      // pr_wake_since: reviews and comments older than this are taken as
      // known when a task's PR is first watched.
      const sessions = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!sessions.some((c) => c.name === "pr_wake_since"))
        db.exec(`ALTER TABLE sessions ADD COLUMN pr_wake_since TEXT`);
      const workspaces = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
        name: string;
      }[];
      if (!workspaces.some((c) => c.name === "wake_tasks_on_pr"))
        db.exec(
          `ALTER TABLE workspaces ADD COLUMN wake_tasks_on_pr INTEGER NOT NULL DEFAULT 1`
        );
    },
  },
  {
    id: 58,
    name: "away_mode",
    up: (db) => {
      // Saad's Away mode (lib/away): one row per time he stepped away. The
      // report is built from the database when it ends and kept here.
      db.exec(`
        CREATE TABLE IF NOT EXISTS away_periods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          set_by TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT,
          ended_at TEXT,
          ended_by TEXT,
          last_sweep_at TEXT,
          asks_notified_at TEXT,
          report TEXT,
          report_seen_at TEXT
        )
      `);
      // What the away sweep did, once per key per period: a nudge, a
      // request to commit, a review run again, a deploy checked.
      db.exec(`
        CREATE TABLE IF NOT EXISTS away_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          away_id INTEGER NOT NULL,
          workspace_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          kind TEXT NOT NULL,
          key TEXT NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (away_id, key)
        )
      `);
      // When a task merged, whichever path merged it.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "merged_at"))
        db.exec(`ALTER TABLE sessions ADD COLUMN merged_at TEXT`);
      // When a task ended without a merge (dropped, or done with no PR or
      // its PR closed).
      if (!columns.some((c) => c.name === "task_ended_at"))
        db.exec(`ALTER TABLE sessions ADD COLUMN task_ended_at TEXT`);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_task_ended_at
          AFTER UPDATE OF task_status ON sessions
          WHEN NEW.task_status IN ('dropped', 'done')
            AND OLD.task_status IS NOT NEW.task_status
            AND NEW.task_ended_at IS OLD.task_ended_at
        BEGIN
          UPDATE sessions SET task_ended_at = datetime('now') WHERE id = NEW.id;
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_merged_at
          AFTER UPDATE OF task_status ON sessions
          WHEN NEW.task_status = 'merged' AND OLD.task_status IS NOT 'merged'
            -- unless the same statement set it (an import keeps its own)
            AND NEW.merged_at IS OLD.merged_at
        BEGIN
          UPDATE sessions SET merged_at = datetime('now') WHERE id = NEW.id;
        END
      `);
      installChangeTriggers(db, TABLES_WATCHED_58);
    },
  },
  {
    id: 59,
    name: "gate_failure_commits",
    up: (db) => {
      // Each head a gate failed on, once: a gate's failure counts once per
      // commit however many times that commit is judged (the armed watcher,
      // CI finishing, sign_off, done, land), and the second commit it fails
      // on goes to Saad. The key is what makes it once, across restarts and
      // concurrent evaluations.
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_gate_failure_commits (
          session_id TEXT NOT NULL,
          gate TEXT NOT NULL,
          sha TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, gate, sha)
        );
        INSERT OR IGNORE INTO orchestrator_gate_failure_commits (session_id, gate, sha, workspace_id, reason)
          SELECT session_id, gate, last_sha, workspace_id, last_reason
          FROM orchestrator_gate_failures WHERE last_sha IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS gate_failures_clear_commits
          AFTER DELETE ON orchestrator_gate_failures
        BEGIN
          DELETE FROM orchestrator_gate_failure_commits
            WHERE session_id = OLD.session_id AND gate = OLD.gate;
        END;
      `);
    },
  },
  {
    id: 60,
    name: "check_runs_and_compactions",
    up: (db) => {
      // What each run of the independent reviewer and the scope check cost,
      // from its claude -p result: it leaves no transcript, so this is the
      // only record. And each compaction a chat's agent made, so tokens per
      // task can be compared before and after the threshold moved.
      db.exec(`
        CREATE TABLE IF NOT EXISTS check_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          label TEXT NOT NULL,
          pr_number INTEGER,
          sha TEXT NOT NULL,
          kind TEXT NOT NULL,
          model TEXT,
          input_tokens INTEGER NOT NULL,
          cache_write_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          duration_ms INTEGER,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_check_runs_at ON check_runs(at);
        CREATE INDEX IF NOT EXISTS idx_check_runs_sha ON check_runs(session_id, sha, kind);
        CREATE TABLE IF NOT EXISTS chat_compactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          workspace_id TEXT,
          at INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          before_tokens INTEGER,
          after_tokens INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_chat_compactions_at ON chat_compactions(at);
      `);
    },
  },
  {
    id: 61,
    name: "model_routing",
    // One transaction, so a crash part-way leaves nothing to skip as
    // "duplicate column" on the next start.
    up: (db) =>
      db.transaction(() => {
        // What a session runs on beyond the model name: its provider (NULL is
        // Anthropic), a task's own models by role (JSON), and a task's plan
        // step (planning, then implementing). Each turn keeps the model,
        // provider and role it ran as, how long it took, and the plan's 5-hour
        // window when it ended, so spend compares by model. A check run keeps the
        // provider its model came from.
        for (const col of [
          `ALTER TABLE sessions ADD COLUMN model_provider TEXT`,
          `ALTER TABLE sessions ADD COLUMN model_overrides TEXT`,
          `ALTER TABLE sessions ADD COLUMN plan_phase TEXT`,
          `ALTER TABLE task_queue ADD COLUMN model_overrides TEXT`,
          `ALTER TABLE chat_turns ADD COLUMN model TEXT`,
          `ALTER TABLE chat_turns ADD COLUMN provider TEXT`,
          `ALTER TABLE chat_turns ADD COLUMN role TEXT`,
          `ALTER TABLE chat_turns ADD COLUMN duration_ms INTEGER`,
          `ALTER TABLE chat_turns ADD COLUMN window_pct REAL`,
          `ALTER TABLE check_runs ADD COLUMN provider TEXT`,
        ])
          db.exec(col);
      })(),
  },
  {
    id: 62,
    name: "sessions_quick_of",
    up: (db) => {
      // A quick change (orchestrator/quick.ts): a task row with no agent,
      // whose worktree the orchestrator with this session id edits itself.
      // Set only by quick_change; the code-review gate reads it.
      const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "quick_of"))
        db.exec(`ALTER TABLE sessions ADD COLUMN quick_of TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_quick_of ON sessions(quick_of) WHERE quick_of IS NOT NULL`
      );
    },
  },
  {
    id: 63,
    name: "one_off_schedules",
    up: (db) =>
      db.transaction(() => {
        // A one-off has a run time (epoch ms, UTC) and no cron; done_at is
        // set once its single run settles. Recurring rows leave both NULL.
        db.exec(`ALTER TABLE schedules ADD COLUMN run_at INTEGER`);
        db.exec(`ALTER TABLE schedules ADD COLUMN done_at INTEGER`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_schedules_run_at ON schedules(run_at) WHERE run_at IS NOT NULL`
        );
      })(),
  },
  {
    id: 64,
    name: "chat_compactions_phase",
    up: (db) => {
      // Whether the agent compacted itself mid-turn or AgentOS (or a typed
      // /compact) did between turns; null on rows from before.
      const columns = db
        .prepare(`PRAGMA table_info(chat_compactions)`)
        .all() as { name: string }[];
      if (!columns.some((c) => c.name === "phase"))
        db.exec(`ALTER TABLE chat_compactions ADD COLUMN phase TEXT`);
    },
  },
  {
    id: 65,
    name: "orchestrator_triage",
    up: (db) => {
      // started_by: the orchestrator session that started this one (null: a
      // person). plan_decided: 1 planned, 0 no plan, null not stated.
      const add = (table: string, col: string, type: string) => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
        }[];
        if (!columns.some((c) => c.name === col))
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      };
      add("sessions", "started_by", "TEXT");
      add("sessions", "plan_decided", "INTEGER");
      add("sessions", "plan_reason", "TEXT");
      add("task_queue", "plan", "INTEGER");
      add("task_queue", "plan_reason", "TEXT");
      add("task_queue", "started_by", "TEXT");
    },
  },
  {
    id: 66,
    name: "workspace_orch_mcp_servers",
    up: (db) => {
      // The MCP servers (by name) a workspace's orchestrator may use.
      const columns = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "orch_mcp_servers"))
        db.exec(
          `ALTER TABLE workspaces ADD COLUMN orch_mcp_servers TEXT NOT NULL DEFAULT '["linear"]'`
        );
    },
  },
  {
    id: 67,
    name: "orchestrator_event_log_suppressed",
    up: (db) => {
      // A capped event is logged as suppressed so a drop leaves a trace.
      const columns = db
        .prepare(`PRAGMA table_info(orchestrator_event_log)`)
        .all() as { name: string }[];
      if (!columns.some((c) => c.name === "suppressed"))
        db.exec(
          `ALTER TABLE orchestrator_event_log ADD COLUMN suppressed TEXT`
        );
    },
  },
  {
    id: 68,
    name: "usage_calls_and_rollups",
    up: (db) => {
      // One row per Claude response (or per one-shot run), the daily rollups
      // computed from them, the ratchet's baseline and the limit readings.
      db.transaction(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS usage_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_key TEXT NOT NULL UNIQUE,
            at INTEGER NOT NULL,
            session_id TEXT,
            task_id TEXT,
            workspace_id TEXT,
            project_id TEXT,
            session_name TEXT,
            role TEXT,
            kind TEXT NOT NULL,
            agent_type TEXT,
            model TEXT,
            provider TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens INTEGER NOT NULL DEFAULT 0,
            cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
            cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            ctx_tokens INTEGER,
            source TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_usage_calls_at ON usage_calls(at);
          CREATE INDEX IF NOT EXISTS idx_usage_calls_task ON usage_calls(task_id);
          CREATE INDEX IF NOT EXISTS idx_usage_calls_session ON usage_calls(session_id);
          CREATE TABLE IF NOT EXISTS rate_limit_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at INTEGER NOT NULL,
            window TEXT NOT NULL,
            utilization REAL NOT NULL,
            raw REAL,
            resets_at INTEGER,
            status TEXT,
            session_id TEXT,
            source TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_rate_limit_readings ON rate_limit_readings(window, at);
          CREATE TABLE IF NOT EXISTS usage_rollups (
            day TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            final INTEGER NOT NULL DEFAULT 0,
            computed_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS usage_baseline (
            metric TEXT PRIMARY KEY,
            value REAL NOT NULL,
            set_at INTEGER NOT NULL,
            supporting TEXT
          );
          CREATE TABLE IF NOT EXISTS usage_alerts (
            kind TEXT PRIMARY KEY,
            opened_at INTEGER NOT NULL,
            cleared_at INTEGER,
            message TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS usage_import_offsets (
            path TEXT PRIMARY KEY,
            offset INTEGER NOT NULL,
            mtime INTEGER NOT NULL
          );
        `);
      })();
    },
  },
  {
    id: 69,
    name: "session_logs",
    up: (db) => {
      // One log per merged task, written by AgentOS from data it already
      // holds (lib/session-logs). Never deleted: the database is the record,
      // the markdown file on disk is a copy.
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_logs (
          session_id TEXT PRIMARY KEY,
          project_id TEXT,
          workspace_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          markdown TEXT NOT NULL,
          data TEXT NOT NULL,
          file_path TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_session_logs_project
          ON session_logs(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_session_logs_workspace
          ON session_logs(workspace_id, created_at);
      `);
    },
  },
  {
    id: 70,
    name: "chat_items_running",
    up: (db) => {
      // What is still running (tools, background tasks) is read on every
      // attach; the index holds only those rows, so it's a lookup, not a
      // scan that parses every tool output of a long conversation.
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_chat_items_running ON chat_items(session_id, kind, seq)
         WHERE json_extract(data, '$.status') = 'running'`
      );
    },
  },
  {
    id: 71,
    name: "devices_push",
    up: (db) => {
      // Push belongs to a paired device, so revoking the device clears it.
      // push_categories is a JSON array; NULL means the defaults.
      // Each column checked, so a run cut off part way can be run again.
      const have = new Set(
        (
          db.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
        ).map((c) => c.name)
      );
      for (const col of [
        "push_token",
        "push_platform",
        "push_environment",
        "push_categories",
        "push_updated_at",
        "push_last_error",
      ])
        if (!have.has(col))
          db.exec(`ALTER TABLE devices ADD COLUMN ${col} TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token)
         WHERE push_token IS NOT NULL`
      );
    },
  },
  {
    id: 72,
    name: "push_outbox",
    up: (db) => {
      // One row per (event, device). device_id is '' for a row folded into
      // the Away digest. state: pending, sending, sent, failed, gone,
      // capped, superseded, folded, digested.
      db.exec(`
        CREATE TABLE IF NOT EXISTS push_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_key TEXT NOT NULL,
          device_id TEXT NOT NULL,
          category TEXT NOT NULL,
          level TEXT NOT NULL,
          payload TEXT NOT NULL,
          collapse_id TEXT,
          state TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          sent_at INTEGER,
          error TEXT,
          fallback_source TEXT,
          fallback_text TEXT,
          UNIQUE(event_key, device_id)
        );
        CREATE INDEX IF NOT EXISTS idx_push_outbox_due ON push_outbox(state, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_push_outbox_device ON push_outbox(device_id, sent_at);
      `);
    },
  },
  {
    id: 73,
    name: "orchestrated_task_moves",
    up: (db) => {
      // task_since: when the task first started, kept across moves (null:
      // created_at). held_by_device / held_from: the device and machine of
      // the orchestrator that moved this task here; only that device may
      // merge, arm, message or move it. plan_note: the "plan written" line
      // of a held task, for its orchestrator to read.
      const add = (col: string) => {
        const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
          name: string;
        }[];
        if (!columns.some((c) => c.name === col))
          db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
      };
      for (const col of [
        "task_since",
        "held_by_device",
        "held_from",
        "plan_note",
      ])
        add(col);
    },
  },
  {
    id: 74,
    name: "held_task_replies",
    up: (db) => {
      // held_for / held_for_name: the orchestrator (id, name there) a held
      // task messages. relay_state: a held task's message to it, waiting for
      // the holder to pull it (pending) or pulled (relayed). relay_key: a
      // pulled message's key on the orchestrator's machine, so a repeat pull
      // is not delivered twice.
      const has = (table: string, col: string) =>
        (
          db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).some((c) => c.name === col);
      for (const col of ["held_for", "held_for_name"])
        if (!has("sessions", col))
          db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
      for (const col of ["relay_state", "relay_key"])
        if (!has("bus_messages", col))
          db.exec(`ALTER TABLE bus_messages ADD COLUMN ${col} TEXT`);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_bus_relay_key ON bus_messages(relay_key) WHERE relay_key IS NOT NULL;
         CREATE INDEX IF NOT EXISTS idx_bus_relay_pending ON bus_messages(relay_state) WHERE relay_state = 'pending'`
      );
    },
  },
  {
    id: 75,
    name: "plan_only_tasks",
    up: (db) => {
      // plan_only: 1 for a task that stops after its plan and waits for
      // approval (plan_phase 'awaiting'); queued tasks keep it until they start.
      const has = (table: string) =>
        (
          db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).some((c) => c.name === "plan_only");
      for (const table of ["sessions", "task_queue"])
        if (!has(table))
          db.exec(`ALTER TABLE ${table} ADD COLUMN plan_only INTEGER`);
    },
  },
  {
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
  },
  {
    id: 77,
    name: "simulator_leases",
    up: (db) => {
      // One iOS simulator a task holds (lib/simulator): the device AgentOS
      // made for it, and where it is in coming up.
      db.exec(
        `CREATE TABLE IF NOT EXISTS simulator_leases (
           session_id TEXT PRIMARY KEY,
           udid TEXT,
           name TEXT NOT NULL,
           state TEXT NOT NULL,
           error TEXT,
           created_at INTEGER NOT NULL,
           last_used_at INTEGER NOT NULL
         )`
      );
    },
  },
  {
    id: 78,
    name: "orchestrator_questions",
    up: (db) => {
      // A question the orchestrator put to Saad in chat, open until he
      // answers it or the orchestrator clears it. needs_you_dismissed: items
      // he hid from the Needs-you strip (an ask's or question's key); hiding
      // never resolves anything.
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_questions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          task TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          resolved_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_orchestrator_questions_open
          ON orchestrator_questions(workspace_id, status);
        CREATE TABLE IF NOT EXISTS needs_you_dismissed (
          workspace_id TEXT NOT NULL,
          key TEXT NOT NULL,
          dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (workspace_id, key)
        );
      `);
      installChangeTriggers(db, TABLES_WATCHED_78);
    },
  },
  {
    id: 79,
    name: "task_queue_agent",
    up: (db) => {
      // The agent CLI a queued task runs with; null is Claude Code.
      const has = (
        db.prepare(`PRAGMA table_info(task_queue)`).all() as { name: string }[]
      ).some((c) => c.name === "agent_type");
      if (!has) db.exec(`ALTER TABLE task_queue ADD COLUMN agent_type TEXT`);
    },
  },
  {
    id: 80,
    name: "recipes",
    up: (db) => {
      // Recipes: a saved brief that starts a fresh task or session each run
      // (lib/recipes), and the features a plan splits into pieces
      // (lib/plans). All additive. A run or piece finds its session by
      // session_id, so sessions gains no column.
      db.exec(`
        CREATE TABLE IF NOT EXISTS recipes (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          brief TEXT NOT NULL,
          model TEXT,
          view TEXT NOT NULL DEFAULT 'chat',
          auto_done INTEGER NOT NULL DEFAULT 1,
          max_minutes INTEGER,
          carry_cleared_at INTEGER,
          source_session_id TEXT,
          created_by_session_id TEXT,
          updated_by_session_id TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_name
          ON recipes(workspace_id, name COLLATE NOCASE) WHERE archived_at IS NULL;

        CREATE TABLE IF NOT EXISTS recipe_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          triggered_by_session_id TEXT,
          schedule_run_id INTEGER,
          request_id TEXT,
          note TEXT,
          prompt TEXT NOT NULL,
          revision_id INTEGER,
          status TEXT NOT NULL,
          session_id TEXT,
          pr_number INTEGER,
          pr_url TEXT,
          summary TEXT,
          outputs TEXT,
          summary_source TEXT,
          error TEXT,
          cost_usd REAL,
          duration_ms INTEGER,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (recipe_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_recipe_runs_recipe
          ON recipe_runs(recipe_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_recipe_runs_session
          ON recipe_runs(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_runs_one_live
          ON recipe_runs(recipe_id)
          WHERE status IN ('queued','starting','running');
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_runs_request
          ON recipe_runs(request_id) WHERE request_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS recipe_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id TEXT NOT NULL,
          brief TEXT NOT NULL,
          settings TEXT NOT NULL,
          edited_by_session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS features (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          plan_session_id TEXT NOT NULL,
          plan_text TEXT NOT NULL,
          status TEXT NOT NULL,
          done_at TEXT,
          cost_usd REAL,
          duration_ms INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_features_plan
          ON features(plan_session_id);

        CREATE TABLE IF NOT EXISTS feature_pieces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          slice TEXT NOT NULL,
          project_id TEXT NOT NULL,
          after_position INTEGER,
          after_kind TEXT,
          reasons TEXT,
          owns TEXT,
          status TEXT NOT NULL,
          session_id TEXT,
          note TEXT,
          UNIQUE (feature_id, position)
        );
        CREATE INDEX IF NOT EXISTS idx_feature_pieces_session
          ON feature_pieces(session_id);
      `);
      const cols = (
        db.prepare(`PRAGMA table_info(schedules)`).all() as { name: string }[]
      ).map((c) => c.name);
      if (!cols.includes("recipe_id"))
        db.exec(`ALTER TABLE schedules ADD COLUMN recipe_id TEXT`);
      if (!cols.includes("migrated_from_kind"))
        db.exec(`ALTER TABLE schedules ADD COLUMN migrated_from_kind TEXT`);
      const plan = (
        db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
      ).map((c) => c.name);
      // Edits Saad made to a plan's pieces before approving it (merge, drop).
      if (!plan.includes("plan_edits"))
        db.exec(`ALTER TABLE sessions ADD COLUMN plan_edits TEXT`);
      installChangeTriggers(db, TABLES_WATCHED_80);
    },
  },
  {
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
  },
  {
    id: 82,
    name: "session_shelf_times",
    up: (db) => {
      const cols = (
        db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
      ).map((c) => c.name);
      // Last real activity, when it was marked done, and the snooze.
      for (const col of [
        "active_at",
        "settled_at",
        "snoozed_until",
        "snoozed_at",
      ])
        if (!cols.includes(col))
          db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
      db.exec(
        `UPDATE sessions SET active_at = updated_at WHERE active_at IS NULL`
      );
    },
  },
  {
    id: 83,
    name: "native_devices_can_approve",
    up: (db) => {
      // New native pairings start with Can approve; this gives it once to the
      // ones paired before. The claim wasn't recorded, so the app is known by
      // its user agent (`AgentOS/<build> CFNetwork/...` on iOS) or by an
      // app push token. It only ever turns the flag on.
      db.exec(
        `UPDATE devices SET can_approve = 1
         WHERE revoked_at IS NULL AND can_approve = 0
           AND (user_agent LIKE 'AgentOS/% CFNetwork/%'
                OR push_platform IN ('ios', 'android'))`
      );
    },
  },
  {
    id: 84,
    name: "approval_audit",
    up: (db) => {
      // Every approval No approvals mode made in place of a person.
      db.exec(`
        CREATE TABLE IF NOT EXISTS approval_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL DEFAULT (datetime('now')),
          source TEXT NOT NULL,
          workspace_id TEXT,
          session_id TEXT,
          subject TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT ''
        )
      `);
    },
  },
  {
    id: 85,
    name: "experiment_usage",
    up: (db) => {
      // What each experiment did: model calls with their cost, and the
      // non-model work (scripts run, suggestions shown and decided).
      db.exec(`
        CREATE TABLE IF NOT EXISTS experiment_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          experiment_id TEXT NOT NULL,
          event TEXT NOT NULL,
          trigger TEXT NOT NULL,
          session_id TEXT,
          workspace_id TEXT,
          model TEXT,
          provider TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          duration_ms INTEGER,
          ok INTEGER NOT NULL DEFAULT 1,
          detail TEXT,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_experiment_usage_exp_at
          ON experiment_usage(experiment_id, at);
        CREATE INDEX IF NOT EXISTS idx_experiment_usage_session
          ON experiment_usage(session_id, experiment_id, event);
      `);
    },
  },
  {
    id: 86,
    name: "learning_cards",
    up: (db) => {
      // End-of-session suggestions (save as recipe, keep a lesson). An
      // accepted lesson row is the record of where it was applied.
      db.exec(`
        CREATE TABLE IF NOT EXISTS learning_cards (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          workspace_id TEXT,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          payload TEXT NOT NULL,
          destination TEXT,
          applied_ref TEXT,
          shown_at INTEGER,
          decided_at INTEGER,
          created_at INTEGER NOT NULL,
          UNIQUE (session_id, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_learning_cards_dest
          ON learning_cards(destination, decided_at);
      `);
    },
  },
  {
    id: 87,
    name: "plan_pieces_reconcile",
    up: (db) => {
      // How many pieces a plan listed and what the checker folded, so a plan
      // that builds as fewer than it listed is never silent; the PRs agents
      // opened (from their `gh pr create` output) so one outside its task's
      // repo is noticed.
      const columns = db.prepare(`PRAGMA table_info(features)`).all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "listed"))
        db.exec(`ALTER TABLE features ADD COLUMN listed INTEGER`);
      if (!columns.some((c) => c.name === "folded"))
        db.exec(`ALTER TABLE features ADD COLUMN folded TEXT`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_prs (
          url TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          repo TEXT NOT NULL,
          number INTEGER NOT NULL,
          seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          told_at TEXT
        );
      `);
    },
  },
  {
    id: 88,
    name: "shared_links",
    up: (db) => {
      // Snapshot links made through Connect. Connect keeps only a digest of
      // the token, so this is the one place the link can be copied again.
      db.exec(`
        CREATE TABLE IF NOT EXISTS shared_links (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          session_id TEXT,
          artifact_id TEXT,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_shared_links_created
          ON shared_links(created_at DESC);
      `);
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
