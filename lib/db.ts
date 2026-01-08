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
  group_path: string;
  agent_type: AgentType;
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

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
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
      `INSERT INTO sessions (id, name, working_directory, parent_session_id, model, system_prompt, group_path, agent_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
      `INSERT INTO sessions (id, name, working_directory, conductor_session_id, worker_task, worker_status, model, group_path, agent_type)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ),
};
