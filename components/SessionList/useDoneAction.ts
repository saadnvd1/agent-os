import { toast } from "sonner";
import type { Session } from "@/lib/db";
import { useDoneSession, useUnarchiveSession } from "@/data/done";

// Done from a session's menu: an open PR merges through the gates, so that
// one asks first; the rest can be undone from the toast.
export function useDoneAction() {
  const done = useDoneSession();
  const unarchive = useUnarchiveSession();
  return (session: Session) => {
    const merges =
      session.task_status === "running" && session.pr_status === "open";
    if (
      merges &&
      !confirm(
        `Merge ${session.name}'s PR through the gates and finish it? A failing gate refuses and nothing merges.`
      )
    )
      return;
    const id = toast.loading(
      merges ? `Merging ${session.name}…` : `Finishing ${session.name}…`
    );
    done.mutate(session.id, {
      onSuccess: (outcome) =>
        toast.success(outcome.text, {
          id,
          duration: 8000,
          action: {
            label: "Undo",
            onClick: () => unarchive.mutate(session.id),
          },
        }),
      onError: (e) => toast.error(e.message, { id, duration: 12000 }),
    });
  };
}
