/**
 * A new user's first project: it lands in a default workspace, and the
 * workspace's first project gives it its orchestrator, so nobody has to know
 * orchestrators exist. Off with the `orchestrators.auto` setting set to "off"
 * or AGENTOS_ORCHESTRATORS=off.
 */

import { db } from "../db";
import { getSetting } from "../settings-store";
import { createWorkspace, listWorkspaces } from "../workspaces";
import { ensureOrchestrator, getOrchestrator } from "./home";

export const DEFAULT_WORKSPACE_NAME = "My workspace";

export function autoOrchestratorsOff(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.AGENTOS_ORCHESTRATORS === "off" ||
    getSetting("orchestrators.auto") === "off"
  );
}

const ownProjects = (where: string, ...args: string[]) =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM projects WHERE is_uncategorized = 0 ${where}`
      )
      .get(...args) as { n: number }
  ).n;

// Where a project added with no workspace goes: on a database with no
// workspaces and no projects yet, a default one; otherwise where it was asked.
export function workspaceForNewProject(
  requested: string | null
): string | null {
  if (requested || autoOrchestratorsOff()) return requested;
  if (listWorkspaces().length > 0 || ownProjects("") > 0) return null;
  return createWorkspace(DEFAULT_WORKSPACE_NAME).id;
}

// A workspace's first project makes its orchestrator. Never fails the add:
// it's a row and a folder, and no agent starts until its first message.
export function afterProjectAdded(workspaceId: string | null): void {
  if (!workspaceId || autoOrchestratorsOff()) return;
  try {
    if (ownProjects("AND workspace_id = ?", workspaceId) !== 1) return;
    if (!getOrchestrator(workspaceId)) ensureOrchestrator(workspaceId);
  } catch (error) {
    console.error("Couldn't make the workspace's orchestrator:", error);
  }
}
