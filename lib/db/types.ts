import type { AgentType } from "../providers";
import type { ChatAccess } from "../chat/events";

export interface Session {
  id: string;
  name: string;
  tmux_name: string;
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
  host_id: string;
  // Async tasks: a session started from a prompt that ends in a PR
  task_prompt: string | null;
  // done: finished without a merge (no PR, or its PR closed).
  task_status: "running" | "merged" | "dropped" | "done" | null;
  // How the session is shown: a chat conversation or a terminal.
  view: "chat" | "terminal";
  chat_access: ChatAccess;
  chat_resume_at: string | null;
  last_seen_at: string | null;
  // Set by done: hidden from the sidebar and the orchestrator, never deleted.
  archived_at: string | null;
  // On the sidebar's Pinned shelf (0/1 from SQLite).
  pinned: boolean;
  // A workspace's standing orchestrator chat (and that workspace), or null.
  role: "orchestrator" | null;
  // An orchestrator's tool-call secret.
  orch_token?: string | null;
  workspace_id: string | null;
  // LumifyHub card this task moves (and the board it's on)
  lh_card_id: string | null;
  lh_board_id: string | null;
  lh_card_list: string | null;
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

export interface Project {
  id: string;
  name: string;
  working_directory: string;
  agent_type: AgentType;
  default_model: string;
  initial_prompt: string | null;
  expanded: boolean;
  sort_order: number;
  is_uncategorized: boolean;
  host_id: string;
  workspace_id: string | null;
  lh_board_id: string | null;
  lh_board_name: string | null;
  lh_board_page_id: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface ProjectRepository {
  id: string;
  project_id: string;
  name: string;
  path: string;
  is_primary: boolean;
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

export interface Workspace {
  id: string;
  name: string;
  sort_order: number;
  collapsed: boolean;
  lh_workspace_id: string | null;
  lh_workspace_slug: string | null;
  lh_workspace_name: string | null;
  // The orchestrator's brakes, and the one in force (noted once).
  orch_max_running: number;
  orch_max_starts_per_hour: number;
  orch_brake: string | null;
  // Set while Saad has the orchestrator paused.
  orch_paused_at: string | null;
  created_at: string;
}

export interface Host {
  id: string;
  name: string;
  ssh_target: string;
  sort_order: number;
  created_at: string;
}
