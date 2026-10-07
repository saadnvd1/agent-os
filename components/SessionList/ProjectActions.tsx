"use client";

import {
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  Pencil,
  Plus,
  Server,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import { ProjectBoardItem } from "@/components/LumifyHub";
import type { ProjectWithRepositories } from "@/lib/projects";
import {
  useMoveProjectToWorkspace,
  useWorkspacesQuery,
} from "@/data/workspaces";
import { newDraft } from "@/stores/drafts";

export interface ProjectActionHandlers {
  onNewSession?: (projectId: string) => void;
  onOpenTerminal?: (projectId: string) => void;
  onStartDevServer?: (projectId: string) => void;
  onEdit: (project: ProjectWithRepositories) => void;
  onRename: (project: ProjectWithRepositories) => void;
  onDelete: (projectId: string) => void;
}

const icon = "mr-2 h-3.5 w-3.5";

// What used to live on a project's row: start work in it, its settings,
// its board, its workspace.
export function ProjectActions({
  project,
  handlers,
}: {
  project: ProjectWithRepositories;
  handlers: ProjectActionHandlers;
}) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  const move = useMoveProjectToWorkspace();
  const real = !project.is_uncategorized;
  const Item = DM.DropdownMenuItem;

  return (
    <>
      {handlers.onNewSession && (
        <Item onClick={() => handlers.onNewSession?.(project.id)}>
          <Plus className={icon} />
          New session
        </Item>
      )}
      {real && (
        <Item
          onClick={() =>
            newDraft({ kind: "project", projectId: project.id, openPr: true })
          }
        >
          <ListTodo className={icon} />
          New task
        </Item>
      )}
      {handlers.onOpenTerminal && (
        <Item onClick={() => handlers.onOpenTerminal?.(project.id)}>
          <Terminal className={icon} />
          Open terminal
        </Item>
      )}
      {real && handlers.onStartDevServer && (
        <Item onClick={() => handlers.onStartDevServer?.(project.id)}>
          <Server className={icon} />
          Start dev server
        </Item>
      )}
      {real && (
        <Item onClick={() => handlers.onEdit(project)}>
          <Settings className={icon} />
          Project settings
        </Item>
      )}
      <Item onClick={() => handlers.onRename(project)}>
        <Pencil className={icon} />
        Rename
      </Item>
      {real && project.lh_board_name && (
        <Item disabled>
          <KanbanSquare className={icon} />
          Board: {project.lh_board_name}
        </Item>
      )}
      {real && <ProjectBoardItem project={project} Item={Item} />}
      {real &&
        workspaces
          .filter((w) => w.id !== project.workspace_id)
          .map((w) => (
            <Item
              key={w.id}
              onClick={() =>
                move.mutate({ projectId: project.id, workspaceId: w.id })
              }
            >
              <LayoutGrid className={icon} />
              Move to {w.name}
            </Item>
          ))}
      {real && project.workspace_id && (
        <Item
          onClick={() =>
            move.mutate({ projectId: project.id, workspaceId: null })
          }
        >
          <LayoutGrid className={icon} />
          Remove from workspace
        </Item>
      )}
      {real && (
        <Item
          onClick={() => handlers.onDelete(project.id)}
          className="text-red-500 focus:text-red-500"
        >
          <Trash2 className={icon} />
          Delete project
        </Item>
      )}
    </>
  );
}
