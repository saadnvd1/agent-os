/**
 * A session's project config and ports, for its environment and its brief.
 * The config is read from the project's main checkout, never the worktree:
 * an agent editing agentos.json on its branch can't change its own launch.
 */

import os from "os";
import { db } from "../db";
import { getProject } from "../projects";
import { sessionPorts } from "../ports";
import { loadProjectConfig, projectEnv, type LoadedConfig } from "./index";
import { runningBrief } from "./brief";
import { databaseEnv, sessionDatabase } from "./database";

export const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

export function projectPathOf(sessionId: string): string | null {
  const row = db
    .prepare(`SELECT project_id FROM sessions WHERE id = ?`)
    .get(sessionId) as { project_id: string | null } | undefined;
  if (!row?.project_id) return null;
  const project = getProject(row.project_id);
  // The catch-all project's folder is the home directory, not a project.
  if (!project || project.is_uncategorized) return null;
  return expandHome(project.working_directory);
}

export function sessionConfig(
  sessionId: string
): LoadedConfig & { ports: Record<string, number> | null } {
  const projectPath = projectPathOf(sessionId);
  const loaded = projectPath
    ? loadProjectConfig(projectPath)
    : { config: {}, source: null, error: null };
  return { ...loaded, ports: sessionPorts(sessionId) };
}

// The project's env and the session's ports. Never throws: a terminal or a
// chat must still open when the config can't be read.
export function sessionProjectEnv(sessionId: string): Record<string, string> {
  try {
    const { config, ports } = sessionConfig(sessionId);
    return {
      ...projectEnv(config, ports),
      ...(config.database ? databaseEnv(sessionDatabase(sessionId)) : {}),
    };
  } catch (error) {
    console.error(`[project-config] env for ${sessionId}:`, error);
    return {};
  }
}

export function sessionRunningBrief(sessionId: string): string {
  try {
    const { config, source, ports } = sessionConfig(sessionId);
    return source
      ? runningBrief(config, ports ?? {}, sessionDatabase(sessionId))
      : "";
  } catch (error) {
    console.error(`[project-config] brief for ${sessionId}:`, error);
    return "";
  }
}
