/**
 * "Orchestrator full access" (Saad, 2026-10-18): a workspace's orchestrator
 * runs with no shell deny list, no write limits, no quick-change cap, and
 * may merge directly. Per workspace, on by default, switched in Settings →
 * Workspaces; off restores every guard unchanged. Only an orchestrator
 * session is ever judged by it: task agents, ordinary sessions, devices and
 * other machines' callers are never loosened.
 */

import { getWorkspace } from "../workspaces";
import type { Session } from "../db";

export function fullAccessOn(workspaceId: string | null | undefined): boolean {
  return !!workspaceId && !!getWorkspace(workspaceId)?.orch_full_access;
}

export function orchestratorFullAccess(
  session: Pick<Session, "role" | "workspace_id">
): boolean {
  return session.role === "orchestrator" && fullAccessOn(session.workspace_id);
}
