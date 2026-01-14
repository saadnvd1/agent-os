import { useCallback } from "react";
import {
  useProjectsQuery,
  useToggleProject,
  useDeleteProject,
  useRenameProject,
} from "@/data/projects";

export function useProjects() {
  const { data: projects = [], refetch } = useProjectsQuery();
  const toggleMutation = useToggleProject();
  const deleteMutation = useDeleteProject();
  const renameMutation = useRenameProject();

  const toggleProject = useCallback(
    async (projectId: string, expanded: boolean) => {
      await toggleMutation.mutateAsync({ projectId, expanded });
    },
    [toggleMutation]
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (
        !confirm(
          "Delete this project? Sessions will be moved to Uncategorized."
        )
      )
        return;
      await deleteMutation.mutateAsync(projectId);
    },
    [deleteMutation]
  );

  const renameProject = useCallback(
    async (projectId: string, newName: string) => {
      await renameMutation.mutateAsync({ projectId, newName });
    },
    [renameMutation]
  );

  const fetchProjects = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    projects,
    fetchProjects,
    toggleProject,
    deleteProject,
    renameProject,
  };
}
