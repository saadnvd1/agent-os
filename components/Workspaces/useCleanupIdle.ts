import { toast } from "sonner";
import type { Workspace } from "@/lib/db";
import { useDoneIdle } from "@/data/done";
import { archivedUiActions } from "@/stores/archivedUi";

// Done for every idle or stopped session in the workspace; the Archived
// view opens with what was done, kept or refused.
export function useCleanupIdle(workspace: Workspace) {
  const doneIdle = useDoneIdle();
  return () => {
    if (
      !confirm(
        `Finish every idle or stopped session in ${workspace.name}? Open PRs that pass the gates are merged; the rest are refused and stay.`
      )
    )
      return;
    const id = toast.loading(`Cleaning up ${workspace.name}…`);
    doneIdle.mutate(workspace.id, {
      onSuccess: (report) => {
        toast.dismiss(id);
        archivedUiActions.open(workspace.id, report);
      },
      onError: (e) => toast.error(e.message, { id }),
    });
  };
}
