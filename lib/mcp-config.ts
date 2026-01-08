/**
 * MCP Config Auto-Generation
 *
 * Writes a .mcp.json file to the session's working directory so Claude
 * automatically picks up the orchestration tools with the session ID baked in.
 */

import { writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";

const AGENTOS_URL = process.env.AGENTOS_URL || "http://localhost:3011";

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Write or update .mcp.json in the working directory with orchestration server config
 */
export function ensureMcpConfig(workingDirectory: string, sessionId: string): void {
  const configPath = path.join(workingDirectory, ".mcp.json");
  const orchestrationServerPath = path.join(process.cwd(), "mcp", "orchestration-server.ts");

  let config: McpConfig = { mcpServers: {} };

  // Read existing config if present
  if (existsSync(configPath)) {
    try {
      const existing = readFileSync(configPath, "utf-8");
      config = JSON.parse(existing);
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
    } catch {
      // Invalid JSON, start fresh
      config = { mcpServers: {} };
    }
  }

  // Add/update agent-os orchestration server
  config.mcpServers["agent-os"] = {
    command: "npx",
    args: ["tsx", orchestrationServerPath],
    env: {
      AGENTOS_URL,
      CONDUCTOR_SESSION_ID: sessionId,
    },
  };

  // Write config
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Check if .mcp.json exists and has agent-os configured
 */
export function hasMcpConfig(workingDirectory: string): boolean {
  const configPath = path.join(workingDirectory, ".mcp.json");
  if (!existsSync(configPath)) return false;

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return !!config.mcpServers?.["agent-os"];
  } catch {
    return false;
  }
}
