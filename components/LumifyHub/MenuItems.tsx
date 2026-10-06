"use client";

import type { ComponentType, ReactNode } from "react";
import { BookOpen, KanbanSquare, Share2 } from "lucide-react";
import type { Project, Workspace } from "@/lib/db";
import { useLumifyHubStatus } from "@/data/lumifyhub";
import { useWorkspacesQuery } from "@/data/workspaces";
import { lumifyhubUiActions } from "@/stores/lumifyhubUi";
import { docsUiActions } from "@/stores/docsUi";

type MenuItem = ComponentType<{ onClick?: () => void; children: ReactNode }>;

// The one quiet entry point in a workspace's ⋯ menu.
export function WorkspaceLumifyHubItem({
  workspace,
  Item,
}: {
  workspace: Workspace;
  Item: MenuItem;
}) {
  const { data: status } = useLumifyHubStatus();
  if (!status) return null;
  if (!status.connected) {
    return (
      <Item onClick={lumifyhubUiActions.openConnect}>
        <Share2 className="mr-2 h-3 w-3" />
        Docs & boards in LumifyHub
      </Item>
    );
  }
  return (
    <>
      <Item onClick={() => lumifyhubUiActions.openWorkspaceLink(workspace.id)}>
        <Share2 className="mr-2 h-3 w-3" />
        {workspace.lh_workspace_name
          ? `LumifyHub: ${workspace.lh_workspace_name}`
          : "Link to LumifyHub workspace"}
      </Item>
      {workspace.lh_workspace_slug && (
        <Item onClick={() => docsUiActions.open(workspace.id)}>
          <BookOpen className="mr-2 h-3 w-3" />
          Docs
        </Item>
      )}
      <Item onClick={lumifyhubUiActions.openConnect}>
        <span className="mr-2 w-3" />
        LumifyHub account
      </Item>
    </>
  );
}

// "Link board", offered only once the project's workspace is linked.
export function ProjectBoardItem({
  project,
  Item,
}: {
  project: Project;
  Item: MenuItem;
}) {
  const { data: status } = useLumifyHubStatus();
  const { data: workspaces = [] } = useWorkspacesQuery();
  const workspace = workspaces.find((w) => w.id === project.workspace_id);
  if (!status?.connected || !workspace?.lh_workspace_id) return null;
  return (
    <Item onClick={() => lumifyhubUiActions.openBoardLink(project.id)}>
      <KanbanSquare className="mr-2 h-3 w-3" />
      {project.lh_board_id ? "Change board" : "Link board"}
    </Item>
  );
}

// A small chip on the project row when it has a board.
export function BoardChip({ project }: { project: Project }) {
  if (!project.lh_board_id) return null;
  // The usual board is named after its project: an icon says enough.
  const named =
    project.lh_board_name &&
    project.lh_board_name.toLowerCase() !== project.name.toLowerCase();
  return (
    <span
      title={`LumifyHub board: ${project.lh_board_name ?? ""}`}
      className="text-muted-foreground/70 bg-foreground/[0.05] flex max-w-[5rem] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
    >
      <KanbanSquare className="h-2.5 w-2.5 shrink-0" />
      {named && <span className="truncate">{project.lh_board_name}</span>}
    </span>
  );
}
