import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sessionKeys } from "@/data/sessions/keys";

// Deletes the selection in parallel, one toast for the lot.
export function useBulkDelete() {
  const queryClient = useQueryClient();
  return useCallback(
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
}
