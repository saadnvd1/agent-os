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
  start_session: name("start_session"),
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
  ask_saad: name("ask_saad"),
} as const;

// What it may do, fixed by its role: it reads other sessions' text, so it
// never gets a general shell. Anything not listed is refused without asking.
// It acts through its own tools, which are scoped to its workspace and
// braked; the shell keeps only `aos` commands that read, and notify, which
// reaches only Saad, so `aos send`, `task`, `spawn` and `stack` can't go
// around them. It writes files, but never in a project repository, a task
// worktree, AgentOS's own state or a secret file: its worker checks each
// write first (write-guard.ts).
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
  ],
  disallowedTools: [],
};
