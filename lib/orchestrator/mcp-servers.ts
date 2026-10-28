/**
 * The MCP servers an orchestrator may use. Its permissions are otherwise a
 * fixed list (tool-names.ts); each workspace adds whole servers, by name, from
 * Settings → Workspaces. Servers carry their own auth and some send outbound
 * (a message, an email), so none is allowed unless named; the brief keeps
 * those actions as hard lines for ask_saad.
 *
 * Only names are ever read from the Claude config: never env, headers, URLs
 * or tokens.
 */

import fs from "fs";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import os from "os";
import path from "path";
import { ORCHESTRATOR_PERMISSIONS } from "./tool-names";
import { getOrchestrator } from "./home";
import { getWorkspace } from "../workspaces";
import { retireChat } from "../chat/runner";

export const DEFAULT_MCP_SERVERS = ["linear"];

// How Claude Code names a server inside a tool name: anything outside
// letters, digits, "_" and "-" becomes "_".
export const toolPrefix = (server: string) =>
  `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

// The permissions for an orchestrator whose workspace allows these servers:
// a bare mcp__<server> rule allows all of that server's tools.
//
// With full access on, the mode is bypassPermissions: Claude Code always asks
// before writing under .claude/ (skills, settings, hooks), and in dontAsk
// mode that ask is a denial. Off keeps dontAsk and the write guard.
export function orchestratorPermissions(servers: string[], fullAccess = false) {
  const rules = [...new Set(servers.map((s) => s.trim()).filter(Boolean))].map(
    toolPrefix
  );
  return {
    ...ORCHESTRATOR_PERMISSIONS,
    permissionMode: (fullAccess
      ? "bypassPermissions"
      : ORCHESTRATOR_PERMISSIONS.permissionMode) as PermissionMode,
    allowedTools: [...ORCHESTRATOR_PERMISSIONS.allowedTools, ...rules],
  };
}

const claudeDir = () =>
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const keys = (value: unknown): string[] =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];

// Names of the servers the agent sees on this machine: user-level servers
// (~/.claude.json), connectors the account has connected, and the servers
// of installed plugins.
export function configuredMcpServers(): string[] {
  const names = new Set<string>();
  const user = readJson(
    process.env.CLAUDE_CONFIG_DIR
      ? path.join(claudeDir(), ".claude.json")
      : path.join(os.homedir(), ".claude.json")
  ) as Record<string, unknown> | null;
  for (const name of keys(user?.mcpServers)) names.add(name);
  const connectors = user?.claudeAiMcpEverConnected;
  if (Array.isArray(connectors))
    for (const c of connectors) if (typeof c === "string") names.add(c);

  const installed = readJson(
    path.join(claudeDir(), "plugins", "installed_plugins.json")
  ) as { plugins?: Record<string, { installPath?: unknown }[]> } | null;
  for (const [id, installs] of Object.entries(installed?.plugins ?? {})) {
    const plugin = id.split("@")[0];
    const dir = installs?.[0]?.installPath;
    if (typeof dir !== "string") continue;
    const file = readJson(path.join(dir, ".mcp.json")) as Record<
      string,
      unknown
    > | null;
    const servers = keys(file?.mcpServers).length ? file?.mcpServers : file;
    for (const server of keys(servers)) names.add(`plugin:${plugin}:${server}`);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// A workspace's allowed servers changed: its orchestrator's worker ends at its
// next turn boundary and the next one starts with the new permissions.
export async function applyMcpServers(workspaceId: string): Promise<void> {
  const orchestrator = getOrchestrator(workspaceId);
  if (orchestrator && getWorkspace(workspaceId))
    await retireChat(orchestrator.id).catch(() => {});
}
