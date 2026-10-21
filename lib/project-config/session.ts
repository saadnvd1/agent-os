/**
 * A session's project config and ports, for its environment and its brief.
 * The config is read from the project's main checkout, never the worktree:
 * an agent editing agentos.json on its branch can't change its own launch.
 */

import fs from "fs";
import os from "os";
import { sessionTmpDir } from "../sessions/leftovers";
import { db } from "../db";
import { getProject } from "../projects";
import { sessionPorts } from "../ports/allocatePorts";
import { findHardcodedPorts, hardcodedNote } from "../ports/findHardcodedPorts";
import {
  loadProjectConfig,
  NONE,
  projectEnv,
  type LoadedConfig,
} from "./index";
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
  const loaded = projectPath ? loadProjectConfig(projectPath) : NONE;
  return { ...loaded, ports: sessionPorts(sessionId) };
}

// A task's own temp folder, so what it leaves there is removed with it.
// Only a session in a worktree: an orchestrator or a terminal in a checkout
// is long-lived and keeps the system's.
function taskTmpEnv(sessionId: string): Record<string, string> {
  const row = db
    .prepare(`SELECT worktree_path FROM sessions WHERE id = ?`)
    .get(sessionId) as { worktree_path: string | null } | undefined;
  if (!row?.worktree_path) return {};
  const dir = sessionTmpDir(sessionId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A folder left by an earlier run keeps its old mode otherwise.
  fs.chmodSync(dir, 0o700);
  return { TMPDIR: dir };
}

// The project's env and the session's ports. Never throws: a terminal or a
// chat must still open when the config can't be read.
export function sessionProjectEnv(sessionId: string): Record<string, string> {
  try {
    const { config, ports } = sessionConfig(sessionId);
    return {
      ...projectEnv(config, ports),
      ...(config.database ? databaseEnv(sessionDatabase(sessionId)) : {}),
      ...taskTmpEnv(sessionId),
    };
  } catch (error) {
    console.error(`[project-config] env for ${sessionId}:`, error);
    return {};
  }
}

// With no config file the section is only the session's ports, so an agent
// in a project without agentos.json still knows it has them.
export function sessionRunningBrief(sessionId: string): string {
  try {
    const { config, source, warning, ports } = sessionConfig(sessionId);
    if (!source && !ports) return "";
    const dir = projectPathOf(sessionId);
    const primary = ports ? Object.values(ports)[0] : undefined;
    const hardcoded =
      dir && primary !== undefined
        ? findHardcodedPorts(dir, config.dev, primary).map(hardcodedNote)
        : [];
    return source
      ? runningBrief(
          config,
          ports ?? {},
          sessionDatabase(sessionId),
          warning,
          hardcoded
        )
      : runningBrief({}, ports ?? {}, null, null, hardcoded);
  } catch (error) {
    console.error(`[project-config] brief for ${sessionId}:`, error);
    return "";
  }
}
