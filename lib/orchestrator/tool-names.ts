import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// The orchestrator's MCP server and the names Claude sees its tools by.
export const ORCHESTRATOR_SERVER = "agentos";

const name = <T extends string>(tool: T) =>
  `mcp__${ORCHESTRATOR_SERVER}__${tool}` as const;

export const TOOL_NAMES = {
  sessions: name("sessions"),
  read: name("read"),
  cards: name("cards"),
  logs: name("logs"),
  send: name("send"),
  orchestrators: name("orchestrators"),
  message_orchestrator: name("message_orchestrator"),
  start_task: name("start_task"),
  set_task_model: name("set_task_model"),
  start_session: name("start_session"),
  quick_change: name("quick_change"),
  quick_pr: name("quick_pr"),
  stack: name("stack"),
  stack_status: name("stack_status"),
  land: name("land"),
  approve_plan: name("approve_plan"),
  drop: name("drop"),
  move: name("move"),
  stop: name("stop"),
  done: name("done"),
  add_project: name("add_project"),
  note: name("note"),
  question: name("question"),
  resolve_question: name("resolve_question"),
  rule_add: name("rule_add"),
  rule_remove: name("rule_remove"),
  review: name("review"),
  sign_off: name("sign_off"),
  arm: name("arm"),
  disarm: name("disarm"),
  remind_me: name("remind_me"),
  recipes: name("recipes"),
  run_recipe: name("run_recipe"),
  recipe_save: name("recipe_save"),
  recipe_update: name("recipe_update"),
  reminders: name("reminders"),
  cancel_reminder: name("cancel_reminder"),
  ask_saad: name("ask_saad"),
} as const;

// What it may do, fixed by its role. It acts through its own tools, which
// are scoped to its workspace and braked. Its shell runs anything, without
// asking: Saad chose that on 2026-10-11, knowing an orchestrator reads other
// sessions' text and a misled one could get around the gates with
// `python -c` or a script, which no parser sees. Its worker still refuses a
// deny list of shell commands before they run (shell-guard.ts): merging,
// closing or retargeting a PR, pushing, writing in a project repository or
// task worktree other than its own quick changes, writing AgentOS's state,
// stopping AgentOS or its tmux, and reading secrets. That catches honest
// mistakes, not a determined bypass. Its file writes are checked the same
// way, against a longer list (write-guard.ts).
export const ORCHESTRATOR_PERMISSIONS: {
  permissionMode: PermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
} = {
  permissionMode: "dontAsk",
  allowedTools: [
    ...Object.values(TOOL_NAMES),
    "Read",
    "Grep",
    "Glob",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "ToolSearch",
    "TodoWrite",
    // Anything; its worker refuses the deny list (shell-guard.ts).
    "Bash",
  ],
  disallowedTools: [],
};
