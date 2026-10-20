import type Database from "better-sqlite3";
import { SESSION_ROW_COLUMNS } from "./session-parts/columns";

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

// Every session column but the two large text ones, which only the single
// session paths read; a list gets has_brief for whether a brief exists.
// Read from session_rows (lib/db/session-parts).
const LIST_COLUMNS = SESSION_ROW_COLUMNS.filter(
  (n) => n !== "task_brief" && n !== "system_prompt"
);
export function sessionListColumns(_db: Database.Database, alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  const list = LIST_COLUMNS.map((c) => `${prefix}${c}`).join(", ");
  // The recipe run or feature piece a session is, as JSON, for its row's chip.
  const recipe = `(SELECT json_object('id', r.id, 'name', r.name, 'seq', rr.seq, 'status', rr.status) FROM recipe_runs rr JOIN recipes r ON r.id = rr.recipe_id WHERE rr.session_id = ${alias || "session_rows"}.id)`;
  const piece = `(SELECT json_object('feature', f.id, 'name', f.name, 'position', fp.position, 'total', (SELECT COUNT(*) FROM feature_pieces WHERE feature_id = f.id AND status != 'dropped')) FROM feature_pieces fp JOIN features f ON f.id = fp.feature_id WHERE fp.session_id = ${alias || "session_rows"}.id)`;
  return `${list}, (${prefix}task_brief IS NOT NULL AND ${prefix}task_brief != '') AS has_brief, ${recipe} AS recipe_run, ${piece} AS feature_piece`;
}

export const queries = {
  // Sessions
  createSession: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO sessions (id, name, tmux_name, working_directory, parent_session_id, model, system_prompt, group_path, agent_type, auto_approve, project_id, host_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'local'))`
    ),

  getSession: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM session_rows WHERE id = ?`),

  getAllSessions: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT ${sessionListColumns(db)} FROM session_rows ORDER BY updated_at DESC`
    ),

  // The sidebar's sessions: not archived, and not a dropped task (a
  // rejection, not finished work) or one that lives on another machine.
  // Merged tasks stay: they are the Done shelf.
  getSidebarSessions: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT ${sessionListColumns(db)} FROM session_rows
         WHERE archived_at IS NULL
           AND (task_status IS NULL
                OR task_status NOT IN ('dropped', 'moved'))
         ORDER BY updated_at DESC`
    ),

  // The tmux names AgentOS owns, for telling discovered sessions apart.
  getManagedTmuxNames: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT host_id, tmux_name FROM sessions WHERE tmux_name IS NOT NULL AND tmux_name != ''`
    ),

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
      `UPDATE sessions SET name = ?, tmux_name = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  deleteSession: (db: Database.Database) =>
    getStmt(db, `DELETE FROM sessions WHERE id = ?`),

  updateSessionWorktree: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ?, dev_server_port = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET project_id = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  getSessionsByProject: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM session_rows WHERE project_id = ? ORDER BY updated_at DESC`
    ),

  // Orchestration
  getWorkersByConductor: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM session_rows WHERE conductor_session_id = ? ORDER BY created_at ASC`
    ),

  updateWorkerStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET worker_status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  createWorkerSession: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO sessions (id, name, tmux_name, working_directory, conductor_session_id, worker_task, worker_status, model, group_path, agent_type, project_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
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

  // Projects
  createProject: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO projects (id, name, working_directory, agent_type, default_model, initial_prompt, sort_order, host_id, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'local'), ?)`
    ),

  getProject: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM projects WHERE id = ?`),

  getProjectFolders: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT id, host_id, working_directory, is_uncategorized FROM projects`
    ),

  getAllProjects: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM projects ORDER BY is_uncategorized ASC, sort_order ASC, name ASC`
    ),

  updateProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE projects SET name = ?, working_directory = ?, agent_type = ?, default_model = ?, initial_prompt = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateProjectExpanded: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET expanded = ? WHERE id = ?`),

  updateProjectOrder: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET sort_order = ? WHERE id = ?`),

  deleteProject: (db: Database.Database) =>
    getStmt(db, `DELETE FROM projects WHERE id = ? AND is_uncategorized = 0`),

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
    getStmt(
      db,
      `SELECT * FROM project_dev_servers WHERE project_id = ? ORDER BY sort_order ASC`
    ),

  updateProjectDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE project_dev_servers SET name = ?, type = ?, command = ?, port = ?, port_env_var = ?, sort_order = ? WHERE id = ?`
    ),

  deleteProjectDevServer: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_dev_servers WHERE id = ?`),

  deleteProjectDevServers: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_dev_servers WHERE project_id = ?`),

  // Project repositories
  createProjectRepository: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO project_repositories (id, project_id, name, path, is_primary, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),

  getProjectRepository: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM project_repositories WHERE id = ?`),

  getProjectRepositories: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM project_repositories WHERE project_id = ? ORDER BY sort_order ASC`
    ),

  updateProjectRepository: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE project_repositories SET name = ?, path = ?, is_primary = ?, sort_order = ? WHERE id = ?`
    ),

  deleteProjectRepository: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_repositories WHERE id = ?`),

  deleteProjectRepositories: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_repositories WHERE project_id = ?`),

  // Dev servers
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
    getStmt(
      db,
      `SELECT * FROM dev_servers WHERE project_id = ? ORDER BY created_at DESC`
    ),

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
};
