"use client";

import { FolderGit2, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import type { Workspace } from "@/lib/db";
import { useProjectsQuery } from "@/data/projects";
import {
  useMoveProjectToWorkspace,
  useWorkspacesQuery,
} from "@/data/workspaces";
import { paletteActions } from "@/stores/palette";
import { useAddProject } from "./useAddProject";

// "Add existing project…": a searchable pick of the projects not in this
// workspace, under the workspace each is in now; picking one moves it in.
// A new one is the first choice.
export function useAddExistingProject() {
  const { data: projects = [] } = useProjectsQuery();
  const { data: workspaces = [] } = useWorkspacesQuery();
  const move = useMoveProjectToWorkspace();
  const addProject = useAddProject();
  return (workspace: Workspace) => {
    const nameOf = (id: string | null) =>
      workspaces.find((w) => w.id === id)?.name ?? "No workspace";
    const others = projects
      .filter((p) => !p.is_uncategorized && p.workspace_id !== workspace.id)
      .sort(
        (a, b) =>
          nameOf(a.workspace_id).localeCompare(nameOf(b.workspace_id)) ||
          a.name.localeCompare(b.name)
      );
    paletteActions.pick(`Add a project to ${workspace.name}…`, [
      {
        id: "add-existing.new",
        title: "New project (folder, clone or name)…",
        group: "",
        icon: FolderPlus,
        run: addProject,
      },
      ...others.map((p) => ({
        id: `add-existing.${p.id}`,
        title: p.name,
        group: nameOf(p.workspace_id),
        keywords: [p.working_directory],
        icon: FolderGit2,
        run: () =>
          move.mutate(
            { projectId: p.id, workspaceId: workspace.id },
            {
              onSuccess: () =>
                toast.success(`${p.name} moved to ${workspace.name}`),
              onError: (e) => toast.error(e.message),
            }
          ),
      })),
    ]);
  };
}
