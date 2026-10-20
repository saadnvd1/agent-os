import type { AgentType } from "../providers";
import type { ChatAccess } from "../chat/events";

export interface Session {
  id: string;
  name: string;
  // Who named it: never auto-renamed when "user".
  name_source: "user" | "generated" | "default";
  tmux_name: string;
  created_at: string;
  updated_at: string;
  status: "idle" | "running" | "waiting" | "error";
  working_directory: string;
  parent_session_id: string | null;
  claude_session_id: string | null;
  model: string;
  // The model's provider (lib/models), NULL for Anthropic.
  model_provider?: string | null;
  // A task's own models: "provider/model", or JSON of role to one.
  model_overrides?: string | null;
  // A task's plan step: planning on the planning model, then implementing.
  // 'awaiting': a plan-only task's plan is written; it waits for approval.
  plan_phase?: "planning" | "awaiting" | "handoff" | "implementing" | null;
  plan_only?: number | null;
  // The orchestrator session that started this one; null for a person.
  started_by?: string | null;
  // How it started: session, orchestrator, person, plan, schedule, recipe, stack or remote.
  started_via?: string | null;
  // 1 planned, 0 no plan, null not stated; why, in the starter's words.
  plan_decided?: number | null;
  // JSON: the pieces Saad merged or dropped before approving the plan.
  plan_edits?: string | null;
  plan_reason?: string | null;
  system_prompt: string | null;
  group_path: string; // Deprecated - use project_id
  project_id: string | null;
  agent_type: AgentType;
  auto_approve: boolean;
  host_id: string;
  // Async tasks: a session started from a prompt that ends in a PR
  task_prompt: string | null;
  // done: finished without a merge (no PR, or its PR closed).
  // moving: handing it to another machine (moved_to); moved: handed over.
  task_status:
    "running" | "merged" | "dropped" | "done" | "moving" | "moved" | null;
  moved_to: string | null;
  // The session on another machine this task arrived from.
  moved_from: string | null;
  // The task's worktree setup, which its agent waits for.
  setup_status?: "running" | "held" | "ok" | "failed" | null;
  setup_ms?: number | null;
  setup_error?: string | null;
  task_brief?: string | null;
  // Lists carry this instead of the brief itself (0/1).
  has_brief?: number;
  // JSON, in lists: the recipe run this session is ({id, name, seq}), and the
  // feature piece it builds ({feature, name, position, total}).
  recipe_run?: string | null;
  feature_piece?: string | null;
  // How the session is shown: a chat conversation or a terminal.
  view: "chat" | "terminal";
  chat_access: ChatAccess;
  chat_resume_at: string | null;
  chat_suggestion: string | null;
  // Its last worker retired cleanly after a deploy (0/1): the agent hears so.
  chat_restarted?: boolean | number;
  // The digest of the tools its last chat worker gave the agent.
  chat_tools_digest?: string | null;
  // Its last worker ended the conversation at the context threshold: the
  // tokens it had reached (0 otherwise). The next one starts a new one and
  // tells the agent so.
  chat_refreshed?: number;
  // Plan mode (0/1 from SQLite), and the context meter's last reading (JSON).
  chat_plan: boolean | number;
  chat_context: string | null;
  chat_usage: string | null;
  last_seen_at: string | null;
  // Last real activity: a message, a run starting, a need (null: updated_at).
  active_at?: string | null;
  // Marked done by hand: Done until new activity (not archived).
  settled_at?: string | null;
  // Snoozed until this time, from snoozed_at; activity since wakes it early.
  snoozed_until?: string | null;
  snoozed_at?: string | null;
  // Task priority (null reads as normal) and timed pause (lib/tasks/pause.ts):
  // pausing, paused or resuming, until when (null: until resumed).
  priority?: string | null;
  pause_state?: "pausing" | "paused" | "resuming" | null;
  paused_until?: string | null;
  pause_id?: number | null;
  // Why a requested resume hasn't happened yet.
  pause_note?: string | null;
  placed_note?: string | null;
  // Set by done: hidden from the sidebar and the orchestrator, never deleted.
  archived_at: string | null;
  // On the sidebar's Pinned shelf (0/1 from SQLite).
  pinned: boolean;
  // A workspace's standing orchestrator chat (and that workspace), or null.
  role: "orchestrator" | null;
  // An orchestrator's tool-call secret.
  orch_token?: string | null;
  workspace_id: string | null;
  // A quick change: the orchestrator session that owns it and edits its
  // worktree itself; it has no agent (orchestrator/quick.ts).
  quick_of?: string | null;
  // LumifyHub card this task moves (and the board it's on)
  lh_card_id: string | null;
  lh_board_id: string | null;
  lh_card_list: string | null;
  // Worktree fields (optional)
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string | null;
  dev_server_port: number | null;
  // Port slot and the ports it resolves to, JSON {NAME: port} (lib/ports.ts)
  port_slot?: number | null;
  ports?: string | null;
  // Its private Postgres copy, JSON (lib/project-config/database.ts)
  database?: string | null;
  // PR tracking
  // 1: a linked machine's own session, shown here (lib/hosts/peer-sync.ts).
  peer_mirror?: number;
  pr_url: string | null;
  pr_number: number | null;
  pr_status: "open" | "merged" | "closed" | null;
  // When task_status became merged (a trigger sets it, migration 58).
  merged_at?: string | null;
  // When it became dropped or done (migration 58).
  task_ended_at?: string | null;
  // Merge as soon as every gate passes (orchestrator/armed.ts), and the
  // failure last reported while armed.
  merge_armed_at?: string | null;
  merge_armed_seen?: string | null;
  // An automatic rebase onto the base: the head the task pushed and the
  // head the rebase left (orchestrator/rebase.ts).
  rebased_from?: string | null;
  rebased_to?: string | null;
  // The PR head the task was last asked to rebase by hand.
  rebase_asked_head?: string | null;
  // When its PR's reviews and comments started being watched (pr-wake.ts).
  pr_wake_since?: string | null;
  // When the task first started, kept across moves (null: created_at).
  task_since?: string | null;
  // The device and machine of the orchestrator that moved this task here.
  held_by_device?: string | null;
  held_from?: string | null;
  // The paired device that started this task here over the API.
  started_by_device?: string | null;
  held_for?: string | null;
  held_for_name?: string | null;
  // A held task's "plan written" line, for its orchestrator to read.
  plan_note?: string | null;
  // The task's plan stops for the machine that placed it here to decide what
  // comes next (1); on that machine's mirror, the approval's message waits for
  // the move home.
  plan_waits_for_caller?: number | null;
  plan_handoff_message?: string | null;
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

// production: every merge gate applies. fast: a task's PR merges when it opens.
export type ProjectTier = "production" | "fast";

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
  tier: ProjectTier;
  // What its tasks need from a machine (JSON array), and where that came from.
  machine_needs?: string | null;
  machine_needs_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskPause {
  id: number;
  session_id: string;
  mode: "turn" | "now";
  by_kind: "person" | "orchestrator" | "scheduler";
  by_id: string | null;
  reason: string | null;
  until_at: string | null;
  state: "pausing" | "paused" | "resuming" | "ended";
  requested_at: string;
  paused_at: string | null;
  resume_requested_at: string | null;
  resume_by_kind: string | null;
  resumed_at: string | null;
  ended_at: string | null;
  end_reason: "resumed" | "cancelled" | "finished" | "failed" | null;
  interrupted: number;
  held_count: number;
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
  // MCP servers (by name) its orchestrator may use.
  orch_mcp_servers: string[];
  // Set while Saad has the orchestrator paused.
  orch_paused_at: string | null;
  // Tasks running at once before new ones queue (lib/tasks/queue.ts); null: no limit.
  max_running_tasks: number | null;
  // Tasks are messaged about failing checks and reviews on their PRs
  // (orchestrator/pr-wake.ts).
  wake_tasks_on_pr: boolean;
  // Its orchestrator's shell and file writes aren't checked, and it may merge
  // directly (orchestrator/full-access.ts).
  orch_full_access: boolean;
  created_at: string;
}

export interface Host {
  id: string;
  name: string;
  ssh_target: string;
  sort_order: number;
  created_at: string;
  // 'connect': reached only through Connect (lib/peer), ssh_target is ''.
  kind?: "ssh" | "connect";
  // Paired with that machine's own AgentOS (lib/hosts/link.ts); 0/1 from SQLite.
  linked?: boolean | number;
}
