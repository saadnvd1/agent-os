/**
 * Linking AgentOS workspaces to LumifyHub workspaces, and projects to boards
 * in them. Each is linked once, by the user.
 */

import { db, lumifyhubQueries as q, type Project, type Workspace } from "../db";
import { getWorkspace } from "../workspaces";
import { getProject } from "../projects";
import { requireClient } from "./connection";
import { ensureTaskLists } from "./lists";
import type { LhBoard, LhWorkspace } from "./types";

export * from "./urls";

export function listLhWorkspaces(): Promise<LhWorkspace[]> {
  return requireClient().listWorkspaces();
}

function workspaceOrThrow(id: string): Workspace {
  const workspace = getWorkspace(id);
  if (!workspace) throw new Error("Workspace not found");
  return workspace;
}

// Link to an existing LumifyHub workspace, or create one (named after the
// AgentOS workspace unless a name is given). Creating is idempotent on name.
export async function linkWorkspace(
  workspaceId: string,
  target: { lhWorkspaceId: string } | { create: true; name?: string }
): Promise<Workspace> {
  const workspace = workspaceOrThrow(workspaceId);
  const client = requireClient();
  let lh: LhWorkspace | undefined;
  if ("create" in target) {
    lh = await client.createWorkspace(target.name?.trim() || workspace.name);
  } else {
    lh = (await client.listWorkspaces()).find(
      (w) => w.id === target.lhWorkspaceId
    );
    if (!lh) throw new Error("LumifyHub workspace not found");
  }
  if (workspace.lh_workspace_id && workspace.lh_workspace_id !== lh.id) {
    q.unlinkWorkspaceBoards(db, workspaceId);
  }
  q.linkWorkspace(db, workspaceId, lh);
  return getWorkspace(workspaceId)!;
}

export function unlinkWorkspace(workspaceId: string): void {
  workspaceOrThrow(workspaceId);
  db.transaction(() => {
    q.unlinkWorkspaceBoards(db, workspaceId);
    q.linkWorkspace(db, workspaceId, null);
  })();
}

// The linked LumifyHub workspace a project's boards live in.
export function linkedWorkspaceFor(project: Project): Workspace {
  const workspace = project.workspace_id
    ? getWorkspace(project.workspace_id)
    : null;
  if (!workspace?.lh_workspace_slug) {
    throw new Error("Link the project's workspace to LumifyHub first");
  }
  return workspace;
}

export async function listWorkspaceBoards(
  workspaceId: string
): Promise<LhBoard[]> {
  const workspace = workspaceOrThrow(workspaceId);
  if (!workspace.lh_workspace_slug) {
    throw new Error("This workspace isn't linked to LumifyHub");
  }
  return requireClient().listBoards(workspace.lh_workspace_slug);
}

function projectOrThrow(id: string): Project {
  const project = getProject(id);
  if (!project || project.is_uncategorized) throw new Error("Unknown project");
  return project;
}

// Link an existing board in the workspace, or create one named after the
// project. Either way the board ends up with the four task lists.
export async function linkProjectBoard(
  projectId: string,
  target: { boardId: string } | { create: true; title?: string }
): Promise<Project> {
  const project = projectOrThrow(projectId);
  const workspace = linkedWorkspaceFor(project);
  const client = requireClient();
  let board: LhBoard | undefined;
  if ("create" in target) {
    board = await client.createBoard(
      workspace.lh_workspace_slug!,
      target.title?.trim() || project.name
    );
  } else {
    board = (await client.listBoards(workspace.lh_workspace_slug!)).find(
      (b) => b.id === target.boardId
    );
    if (!board) throw new Error("Board not found in this workspace");
  }
  await ensureTaskLists(client, board.id, true);
  q.linkProjectBoard(db, projectId, {
    id: board.id,
    title: board.title,
    pageId: board.page_id,
  });
  return getProject(projectId)!;
}

export function unlinkProjectBoard(projectId: string): void {
  projectOrThrow(projectId);
  q.linkProjectBoard(db, projectId, null);
}
