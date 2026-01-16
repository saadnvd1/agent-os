import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useDeleteSession,
  useRenameSession,
  useForkSession,
  useSummarizeSession,
  useMoveSessionToProject,
} from "@/data/sessions";
import {
  useToggleProject,
  useDeleteProject,
  useRenameProject,
} from "@/data/projects";
import { useToggleGroup, useCreateGroup, useDeleteGroup } from "@/data/groups";
import {
  useStopDevServer,
  useRestartDevServer,
  useRemoveDevServer,
} from "@/data/dev-servers";
import { sessionKeys } from "@/data/sessions/keys";

interface UseSessionListMutationsOptions {
  onSelectSession: (sessionId: string) => void;
}

export function useSessionListMutations({
  onSelectSession,
}: UseSessionListMutationsOptions) {
  const queryClient = useQueryClient();

  // Session mutations
  const deleteSessionMutation = useDeleteSession();
  const renameSessionMutation = useRenameSession();
  const forkSessionMutation = useForkSession();
  const summarizeSessionMutation = useSummarizeSession();
  const moveSessionToProjectMutation = useMoveSessionToProject();

  // Project mutations
  const toggleProjectMutation = useToggleProject();
  const deleteProjectMutation = useDeleteProject();
  const renameProjectMutation = useRenameProject();

  // Group mutations
  const toggleGroupMutation = useToggleGroup();
  const createGroupMutation = useCreateGroup();
  const deleteGroupMutation = useDeleteGroup();

  // Dev server mutations
  const stopDevServerMutation = useStopDevServer();
  const restartDevServerMutation = useRestartDevServer();
  const removeDevServerMutation = useRemoveDevServer();

  // Derived state
  const summarizingSessionId = summarizeSessionMutation.isPending
    ? (summarizeSessionMutation.variables as string)
    : null;

  // Session handlers
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm("Delete this session? This cannot be undone.")) return;
      await deleteSessionMutation.mutateAsync(sessionId);
    },
    [deleteSessionMutation]
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newName: string) => {
      await renameSessionMutation.mutateAsync({ sessionId, newName });
    },
    [renameSessionMutation]
  );

  const handleForkSession = useCallback(
    async (sessionId: string) => {
      const forkedSession = await forkSessionMutation.mutateAsync(sessionId);
      if (forkedSession) onSelectSession(forkedSession.id);
    },
    [forkSessionMutation, onSelectSession]
  );

  const handleSummarize = useCallback(
    async (sessionId: string) => {
      const newSession = await summarizeSessionMutation.mutateAsync(sessionId);
      if (newSession) onSelectSession(newSession.id);
    },
    [summarizeSessionMutation, onSelectSession]
  );

  const handleMoveSessionToProject = useCallback(
    async (sessionId: string, projectId: string) => {
      await moveSessionToProjectMutation.mutateAsync({ sessionId, projectId });
    },
    [moveSessionToProjectMutation]
  );

  // Project handlers
  const handleToggleProject = useCallback(
    async (projectId: string, expanded: boolean) => {
      await toggleProjectMutation.mutateAsync({ projectId, expanded });
    },
    [toggleProjectMutation]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      if (
        !confirm(
          "Delete this project? Sessions will be moved to Uncategorized."
        )
      )
        return;
      await deleteProjectMutation.mutateAsync(projectId);
    },
    [deleteProjectMutation]
  );

  const handleRenameProject = useCallback(
    async (projectId: string, newName: string) => {
      await renameProjectMutation.mutateAsync({ projectId, newName });
    },
    [renameProjectMutation]
  );

  // Group handlers
  const handleToggleGroup = useCallback(
    async (path: string, expanded: boolean) => {
      await toggleGroupMutation.mutateAsync({ path, expanded });
    },
    [toggleGroupMutation]
  );

  const handleCreateGroup = useCallback(
    async (name: string, parentPath?: string) => {
      await createGroupMutation.mutateAsync({ name, parentPath });
    },
    [createGroupMutation]
  );

  const handleDeleteGroup = useCallback(
    async (path: string) => {
      if (!confirm("Delete this group? Sessions will be moved to parent."))
        return;
      await deleteGroupMutation.mutateAsync(path);
    },
    [deleteGroupMutation]
  );

  // Dev server handlers
  const handleStopDevServer = useCallback(
    async (serverId: string) => {
      await stopDevServerMutation.mutateAsync(serverId);
    },
    [stopDevServerMutation]
  );

  const handleRestartDevServer = useCallback(
    async (serverId: string) => {
      await restartDevServerMutation.mutateAsync(serverId);
    },
    [restartDevServerMutation]
  );

  const handleRemoveDevServer = useCallback(
    async (serverId: string) => {
      await removeDevServerMutation.mutateAsync(serverId);
    },
    [removeDevServerMutation]
  );

  // Bulk delete handler
  const handleBulkDelete = useCallback(
    async (sessionIds: string[]) => {
      const count = sessionIds.length;
      const hasWorktrees = sessionIds.length > 0; // Assume some might have worktrees

      // Show toast with progress
      const toastId = toast.loading(
        hasWorktrees
          ? `Deleting ${count} session${count > 1 ? "s" : ""}... cleaning up worktrees in background`
          : `Deleting ${count} session${count > 1 ? "s" : ""}...`
      );

      let succeeded = 0;
      let failed = 0;

      // Delete all sessions in parallel for speed
      await Promise.allSettled(
        sessionIds.map(async (sessionId) => {
          try {
            const response = await fetch(`/api/sessions/${sessionId}`, {
              method: "DELETE",
            });
            if (response.ok) {
              succeeded++;
            } else {
              failed++;
            }
          } catch (error) {
            console.error(`Failed to delete session ${sessionId}:`, error);
            failed++;
          }
        })
      );

      // Invalidate cache to refresh UI
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });

      // Update toast based on results
      if (failed === 0) {
        toast.success(
          `Deleted ${succeeded} session${succeeded > 1 ? "s" : ""}`,
          { id: toastId }
        );
      } else if (succeeded === 0) {
        toast.error(
          `Failed to delete ${failed} session${failed > 1 ? "s" : ""}`,
          {
            id: toastId,
          }
        );
      } else {
        toast.warning(
          `Deleted ${succeeded}, failed ${failed} session${failed > 1 ? "s" : ""}`,
          { id: toastId }
        );
      }
    },
    [queryClient]
  );

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
  }, [queryClient]);

  return {
    // Derived state
    summarizingSessionId,

    // Session handlers
    handleDeleteSession,
    handleRenameSession,
    handleForkSession,
    handleSummarize,
    handleMoveSessionToProject,

    // Project handlers
    handleToggleProject,
    handleDeleteProject,
    handleRenameProject,

    // Group handlers
    handleToggleGroup,
    handleCreateGroup,
    handleDeleteGroup,

    // Dev server handlers
    handleStopDevServer,
    handleRestartDevServer,
    handleRemoveDevServer,

    // Bulk operations
    handleBulkDelete,
    handleRefresh,
  };
}
