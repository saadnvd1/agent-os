/**
 * The Docs tab and `aos docs`: a linked workspace's pages, read in AgentOS
 * and edited in LumifyHub (docs/lumifyhub.md, "What maps to what").
 */

import { db, queries, type Session, type Workspace } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { requireClient } from "./connection";
import { linkedWorkspaceFor } from "./links";
import { createPage, getPage, listPages } from "./pages";
import { pageUrl } from "./urls";
import { matchesQuery } from "./doc-tree";
import type { DocSummary, DocView, LhPage } from "./types";

function linkedWorkspace(workspaceId: string): Workspace {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  if (!workspace.lh_workspace_slug) {
    throw new Error("This workspace isn't linked to LumifyHub");
  }
  return workspace;
}

// The linked workspace of the project an agent session runs in.
export function sessionWorkspace(sessionId: string | null): Workspace {
  if (!sessionId) throw new Error("session is required");
  const session = queries.getSession(db).get(sessionId) as Session | undefined;
  if (!session) throw new Error("Unknown session");
  const project = session.project_id ? getProject(session.project_id) : null;
  if (!project) throw new Error("This session has no project");
  return linkedWorkspaceFor(project);
}

const summary = (p: LhPage): DocSummary => ({
  id: p.id,
  title: p.title,
  parentId: p.parent_page_id,
  updatedAt: p.updated_at,
});

function view(p: LhPage, workspace: Workspace, baseUrl: string): DocView {
  return {
    ...summary(p),
    content: p.content,
    url: pageUrl(baseUrl, workspace.lh_workspace_slug!, p.id),
  };
}

// Pages only: the API leaves boards and databases out, and this makes sure.
const isDocument = (p: LhPage) => !p.page_type || p.page_type === "page";

export async function listDocs(
  workspaceId: string,
  query = ""
): Promise<DocSummary[]> {
  const workspace = linkedWorkspace(workspaceId);
  const pages = await listPages(requireClient(), workspace.lh_workspace_slug!);
  return pages
    .filter((p) => isDocument(p) && (!query || matchesQuery(p.title, query)))
    .map(summary);
}

// Only a page in the linked workspace: a session can't read across them.
export async function readDoc(
  workspaceId: string,
  pageId: string
): Promise<DocView> {
  const workspace = linkedWorkspace(workspaceId);
  const client = requireClient();
  const page = await getPage(client, pageId);
  if (page.workspace_id !== workspace.lh_workspace_id || !isDocument(page)) {
    throw new Error("Page not found in this workspace");
  }
  return view(page, workspace, client.baseUrl);
}

export async function createDoc(
  workspaceId: string,
  input: { title?: string; content?: string }
): Promise<DocView> {
  const workspace = linkedWorkspace(workspaceId);
  const title = input.title?.trim();
  if (!title) throw new Error("A page needs a title");
  const client = requireClient();
  const page = await createPage(client, {
    workspace_slug: workspace.lh_workspace_slug!,
    title,
    content: input.content ?? "",
  });
  return view(page, workspace, client.baseUrl);
}
