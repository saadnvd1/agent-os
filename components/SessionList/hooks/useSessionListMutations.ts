import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDeleteSession,
  useRenameSession,
  useForkSession,
  useSummarizeSession,
  useMoveSessionToProject,
} from "@/data/sessions";
import { useDeleteProject, useRenameProject } from "@/data/projects";
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
  const deleteProjectMutation = useDeleteProject();
  const renameProjectMutation = useRenameProject();

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
  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      if (!confirm("Delete this project? Its sessions move to Scratch."))
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
    handleDeleteProject,
    handleRenameProject,

    // Dev server handlers
    handleStopDevServer,
    handleRestartDevServer,
    handleRemoveDevServer,

    // Bulk operations
    handleRefresh,
  };
}
