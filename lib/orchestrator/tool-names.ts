import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// The orchestrator's MCP server and the names Claude sees its tools by.
export const ORCHESTRATOR_SERVER = "agentos";

export const TOOL_NAMES = {
  sessions: `mcp__${ORCHESTRATOR_SERVER}__sessions`,
  read: `mcp__${ORCHESTRATOR_SERVER}__read`,
  cards: `mcp__${ORCHESTRATOR_SERVER}__cards`,
} as const;

// What it may do, fixed by its role: it reads other sessions' text, so it
// never gets a general shell or file edits. Anything not listed is refused
// without asking. Acting tools arrive as MCP tools of its own.
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
    "ToolSearch",
    "TodoWrite",
    "Bash(aos:*)",
  ],
  disallowedTools: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
};
