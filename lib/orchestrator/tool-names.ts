// The orchestrator's MCP server and the names Claude sees its tools by.
export const ORCHESTRATOR_SERVER = "agentos";

export const TOOL_NAMES = {
  sessions: `mcp__${ORCHESTRATOR_SERVER}__sessions`,
  read: `mcp__${ORCHESTRATOR_SERVER}__read`,
  cards: `mcp__${ORCHESTRATOR_SERVER}__cards`,
} as const;
