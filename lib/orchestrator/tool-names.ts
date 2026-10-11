import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// The orchestrator's MCP server and the names Claude sees its tools by.
export const ORCHESTRATOR_SERVER = "agentos";

const name = <T extends string>(tool: T) =>
  `mcp__${ORCHESTRATOR_SERVER}__${tool}` as const;

export const TOOL_NAMES = {
  sessions: name("sessions"),
  read: name("read"),
  cards: name("cards"),
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
  drop: name("drop"),
  stop: name("stop"),
  done: name("done"),
  add_project: name("add_project"),
  note: name("note"),
  rule_add: name("rule_add"),
  rule_remove: name("rule_remove"),
  review: name("review"),
  sign_off: name("sign_off"),
  arm: name("arm"),
  disarm: name("disarm"),
  remind_me: name("remind_me"),
  reminders: name("reminders"),
  cancel_reminder: name("cancel_reminder"),
  ask_saad: name("ask_saad"),
} as const;

// What it may do, fixed by its role: it reads other sessions' text, so it
// never gets a general shell. Anything not listed is refused without asking.
// It acts through its own tools, which are scoped to its workspace and
// braked; the shell keeps only `aos` commands that read, and notify, which
// reaches only Saad, so `aos send`, `task`, `spawn` and `stack` can't go
// around them. It writes files, but never in a project repository, a task
// worktree, AgentOS's own state or a secret file, except inside its own
// quick changes' worktrees (quick.ts), where it may also run git that
// looks, stages or undoes, never commits with hooks or pushes: its worker
// checks each write and each shell command first (write-guard.ts,
// git-guard.ts).
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
    "Bash(aos peers:*)",
    "Bash(aos inbox:*)",
    "Bash(aos history:*)",
    "Bash(aos stacks:*)",
    "Bash(aos schedules:*)",
    // Reaches only Saad's phone, at most once a minute.
    "Bash(aos notify:*)",
    "Bash(aos docs:*)",
    "Bash(aos doc:*)",
    // Only `git -C <its own quick worktree>`, refused anywhere else.
    "Bash(git:*)",
  ],
  disallowedTools: [],
};
