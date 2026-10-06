import type { Workspace } from "@/lib/db";
import { cleanupUiActions } from "@/stores/archivedUi";

// Opens the clean-up preview: nothing happens until it's confirmed there.
export function useCleanupIdle(workspace: Workspace) {
  return () => cleanupUiActions.open(workspace.id);
}
