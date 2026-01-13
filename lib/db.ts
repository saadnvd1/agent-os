import Database from "better-sqlite3";
import path from "path";
import type { AgentType } from "./providers";

const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "agent-os.db");

// Type definitions
export interface Session {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: "idle" | "running" | "waiting" | "error";
  working_directory: string;
  parent_session_id: string | null;
  claude_session_id: string | null;
  model: string;
  system_prompt: string | null;
  group_path: string; // Deprecated - use project_id
  project_id: string | null;
  agent_type: AgentType;
  auto_approve: boolean;
  // Worktree fields (optional)
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string | null;
  dev_server_port: number | null;
  // PR tracking
  pr_url: string | null;
  pr_number: number | null;
  pr_status: "open" | "merged" | "closed" | null;
  // Orchestration fields
  conductor_session_id: string | null;
  worker_task: string | null;
  worker_status: "pending" | "running" | "completed" | "failed" | null;
}

export interface Group {
  path: string;
  name: string;
  expanded: boolean;
  sort_order: number;
  created_at: string;
}

// Projects (replaces Groups)
export interface Project {
  id: string;
  name: string;
  working_directory: string;
  agent_type: AgentType;
  default_model: string;
  expanded: boolean;
  sort_order: number;
  is_uncategorized: boolean;
  created_at: string;
  updated_at: string;
}

// Project dev server configuration (template for dev servers)
export interface ProjectDevServer {
  id: string;
  project_id: string;
  name: string;
  type: DevServerType;
  command: string;
  port: number | null;
  port_env_var: string | null;
  sort_order: number;
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string; // JSON array
  timestamp: string;
  duration_ms: number | null;
}

export interface ToolCall {
  id: number;
  message_id: number;
  session_id: string;
  tool_name: string;
  tool_input: string; // JSON
  tool_result: string | null; // JSON
  status: "pending" | "running" | "completed" | "error";
  timestamp: string;
}

export type DevServerType = "node" | "docker";
export type DevServerStatus = "stopped" | "starting" | "running" | "failed";

export interface DevServer {
  id: string;
  project_id: string;
  type: DevServerType;
  name: string;
  command: string;
  status: DevServerStatus;
  pid: number | null;
  container_id: string | null;
  ports: string; // JSON array of port numbers
  working_directory: string;
  created_at: string;
  updated_at: string;
}

// Initialize database with schema
export function initDb(): Database.Database {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'idle',
      working_directory TEXT NOT NULL DEFAULT '~',
      parent_session_id TEXT,
      claude_session_id TEXT,
      model TEXT DEFAULT 'sonnet',
      system_prompt TEXT,
      group_path TEXT NOT NULL DEFAULT 'sessions',
      agent_type TEXT NOT NULL DEFAULT 'claude',
      FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
    );

    -- Groups table for organizing sessions
    CREATE TABLE IF NOT EXISTS groups (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expanded INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Default group
    INSERT OR IGNORE INTO groups (path, name, sort_order) VALUES ('sessions', 'Sessions', 0);

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Tool calls table (linked to messages)
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_input TEXT NOT NULL,
      tool_result TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Dev servers table (for Phase 9: Container & Development Server Management)
    CREATE TABLE IF NOT EXISTS dev_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'node',
      name TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      container_id TEXT,
      ports TEXT NOT NULL DEFAULT '[]',
      working_directory TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Projects table (replaces groups)
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      agent_type TEXT NOT NULL DEFAULT 'claude',
      default_model TEXT NOT NULL DEFAULT 'sonnet',
      expanded INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_uncategorized INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Project dev servers (configuration templates)
    CREATE TABLE IF NOT EXISTS project_dev_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'node',
      command TEXT NOT NULL,
      port INTEGER,
      port_env_var TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_project_dev_servers_project ON project_dev_servers(project_id);

    -- Default Uncategorized project
    INSERT OR IGNORE INTO projects (id, name, working_directory, is_uncategorized, sort_order)
    VALUES ('uncategorized', 'Uncategorized', '~', 1, 999999);
  `);

  // Migration: Add group_path column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN group_path TEXT NOT NULL DEFAULT 'sessions'`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add agent_type column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude'`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add worktree columns if they don't exist
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN worktree_path TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN branch_name TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN base_branch TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN dev_server_port INTEGER`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add PR tracking columns if they don't exist
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN pr_url TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN pr_number INTEGER`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN pr_status TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Create group_path index after migration ensures column exists
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_path)`);

  // Migration: Add orchestration columns if they don't exist
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN conductor_session_id TEXT REFERENCES sessions(id)`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN worker_task TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN worker_status TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Index for finding workers by conductor
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_conductor ON sessions(conductor_session_id)`);

  // Migration: Add auto_approve column if it doesn't exist
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add new dev_servers columns if they don't exist
  try {
    db.exec(`ALTER TABLE dev_servers ADD COLUMN type TEXT NOT NULL DEFAULT 'node'`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE dev_servers ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE dev_servers ADD COLUMN command TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE dev_servers ADD COLUMN pid INTEGER`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE dev_servers ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Remove preview_url column from dev_servers (no longer used)
  // SQLite doesn't support DROP COLUMN in older versions, so we just ignore the column

  // Migration: Add project_id column to sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Set existing sessions without project_id to uncategorized
  try {
    db.exec(`UPDATE sessions SET project_id = 'uncategorized' WHERE project_id IS NULL`);
  } catch {
    // Ignore errors
  }

  // Create index on project_id after the column exists
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`);
  } catch {
    // Index might already exist or column doesn't exist, ignore
  }

  // Migration: Add project_id column to dev_servers (replacing session_id)
  try {
    db.exec(`ALTER TABLE dev_servers ADD COLUMN project_id TEXT REFERENCES projects(id)`);
    // Migrate existing dev_servers: get project_id from their session
    db.exec(`
      UPDATE dev_servers
      SET project_id = (
        SELECT COALESCE(s.project_id, 'uncategorized')
        FROM sessions s
        WHERE s.id = dev_servers.session_id
      )
      WHERE project_id IS NULL
    `);
    // Set any remaining null project_ids to uncategorized
    db.exec(`UPDATE dev_servers SET project_id = 'uncategorized' WHERE project_id IS NULL`);
  } catch {
    // Column already exists, ignore
  }

  // Create index on dev_servers.project_id after the column exists
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dev_servers_project ON dev_servers(project_id)`);
  } catch {
    // Index might already exist, ignore
  }

  return db;
}

// Singleton database instance
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = initDb();
  }
  return _db;
}

// Direct export for convenience
export const db = getDb();

// Prepared statement cache
const stmtCache = new Map<string, Database.Statement>();

function getStmt(db: Database.Database, sql: string): Database.Statement {
  const key = sql;
  let stmt = stmtCache.get(key);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(key, stmt);
  }
  return stmt;
}

// Query helpers
export const queries = {
  // Sessions
  createSession: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO sessions (id, name, working_directory, parent_session_id, model, system_prompt, group_path, agent_type, auto_approve, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),

  getSession: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM sessions WHERE id = ?`),

  getAllSessions: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM sessions ORDER BY updated_at DESC`),

  updateSessionStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionClaudeId: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionName: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  deleteSession: (db: Database.Database) =>
    getStmt(db, `DELETE FROM sessions WHERE id = ?`),

  updateSessionWorktree: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ?, dev_server_port = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionPR: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  // Messages
  createMessage: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO messages (session_id, role, content, duration_ms)
       VALUES (?, ?, ?, ?)`
    ),

  getSessionMessages: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`
    ),

  getLastMessage: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1`
    ),

  updateMessageDuration: (db: Database.Database) =>
    getStmt(db, `UPDATE messages SET duration_ms = ? WHERE id = ?`),

  // Tool calls
  createToolCall: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO tool_calls (message_id, session_id, tool_name, tool_input, status)
       VALUES (?, ?, ?, ?, 'pending')`
    ),

  updateToolCallResult: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE tool_calls SET tool_result = ?, status = ? WHERE id = ?`
    ),

  updateToolCallStatus: (db: Database.Database) =>
    getStmt(db, `UPDATE tool_calls SET status = ? WHERE id = ?`),

  getSessionToolCalls: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp ASC`
    ),

  getMessageToolCalls: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM tool_calls WHERE message_id = ? ORDER BY timestamp ASC`
    ),

  // Groups
  getAllGroups: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM groups ORDER BY sort_order ASC, name ASC`),

  getGroup: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM groups WHERE path = ?`),

  createGroup: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO groups (path, name, sort_order) VALUES (?, ?, ?)`
    ),

  updateGroupName: (db: Database.Database) =>
    getStmt(db, `UPDATE groups SET name = ? WHERE path = ?`),

  updateGroupExpanded: (db: Database.Database) =>
    getStmt(db, `UPDATE groups SET expanded = ? WHERE path = ?`),

  updateGroupOrder: (db: Database.Database) =>
    getStmt(db, `UPDATE groups SET sort_order = ? WHERE path = ?`),

  deleteGroup: (db: Database.Database) =>
    getStmt(db, `DELETE FROM groups WHERE path = ?`),

  // Update session group
  updateSessionGroup: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET group_path = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  // Get sessions in a group
  getSessionsByGroup: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM sessions WHERE group_path = ? ORDER BY updated_at DESC`
    ),

  // Move sessions from one group to another
  moveSessionsToGroup: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET group_path = ?, updated_at = datetime('now') WHERE group_path = ?`
    ),

  // Orchestration queries
  getWorkersByConductor: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM sessions WHERE conductor_session_id = ? ORDER BY created_at ASC`
    ),

  updateWorkerStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET worker_status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  createWorkerSession: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO sessions (id, name, working_directory, conductor_session_id, worker_task, worker_status, model, group_path, agent_type, project_id)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ),

  // Dev servers (for Phase 9: Container & Development Server Management)
  createDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO dev_servers (id, project_id, type, name, command, status, pid, container_id, ports, working_directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),

  getDevServer: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM dev_servers WHERE id = ?`),

  getAllDevServers: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM dev_servers ORDER BY created_at DESC`),

  getDevServersByProject: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM dev_servers WHERE project_id = ? ORDER BY created_at DESC`),

  updateDevServerStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE dev_servers SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateDevServerPid: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE dev_servers SET pid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE dev_servers SET status = ?, pid = ?, container_id = ?, ports = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  deleteDevServer: (db: Database.Database) =>
    getStmt(db, `DELETE FROM dev_servers WHERE id = ?`),

  deleteDevServersByProject: (db: Database.Database) =>
    getStmt(db, `DELETE FROM dev_servers WHERE project_id = ?`),

  // Projects
  createProject: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO projects (id, name, working_directory, agent_type, default_model, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),

  getProject: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM projects WHERE id = ?`),

  getAllProjects: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM projects ORDER BY is_uncategorized ASC, sort_order ASC, name ASC`),

  updateProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE projects SET name = ?, working_directory = ?, agent_type = ?, default_model = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateProjectExpanded: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET expanded = ? WHERE id = ?`),

  updateProjectOrder: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET sort_order = ? WHERE id = ?`),

  deleteProject: (db: Database.Database) =>
    getStmt(db, `DELETE FROM projects WHERE id = ? AND is_uncategorized = 0`),

  getSessionsByProject: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC`
    ),

  updateSessionProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET project_id = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  // Project dev servers
  createProjectDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO project_dev_servers (id, project_id, name, type, command, port, port_env_var, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),

  getProjectDevServer: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM project_dev_servers WHERE id = ?`),

  getProjectDevServers: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM project_dev_servers WHERE project_id = ? ORDER BY sort_order ASC`),

  updateProjectDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE project_dev_servers SET name = ?, type = ?, command = ?, port = ?, port_env_var = ?, sort_order = ? WHERE id = ?`
    ),

  deleteProjectDevServer: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_dev_servers WHERE id = ?`),

  deleteProjectDevServers: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_dev_servers WHERE project_id = ?`),
};
