import { useCallback } from "react";
import { useToggleGroup, useCreateGroup, useDeleteGroup } from "@/data/groups";

export function useGroups() {
  const toggleMutation = useToggleGroup();
  const createMutation = useCreateGroup();
  const deleteMutation = useDeleteGroup();

  const toggleGroup = useCallback(
    async (path: string, expanded: boolean) => {
      await toggleMutation.mutateAsync({ path, expanded });
    },
    [toggleMutation]
  );

  const createGroup = useCallback(
    async (name: string, parentPath?: string) => {
      await createMutation.mutateAsync({ name, parentPath });
    },
    [createMutation]
  );

  const deleteGroup = useCallback(
    async (path: string) => {
      if (!confirm("Delete this group? Sessions will be moved to parent."))
        return;
      await deleteMutation.mutateAsync(path);
    },
    [deleteMutation]
  );

  return {
    toggleGroup,
    createGroup,
    deleteGroup,
  };
}
