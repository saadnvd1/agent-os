import { toast } from "sonner";
import type { Session } from "@/lib/db";
import {
  useArchiveSession,
  useDoneSession,
  useUnarchiveSession,
} from "@/data/done";
import { useSettleSession } from "@/data/sessions/shelf";

// Done from a session's menu: an open PR merges through the gates, so that
// one asks first; the rest can be undone from the toast.
export function useDoneAction() {
  const done = useDoneSession();
  const settle = useSettleSession();
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
      // Undo only reopens the entry: offered only when that's all done did.
      onSuccess: (outcome) =>
        toast.success(outcome.text, {
          id,
          duration: 8000,
          ...(!outcome.merged &&
            !session.task_status &&
            outcome.worktree.action !== "removed" &&
            outcome.worktree.action !== "gone" && {
              action: {
                label: "Undo",
                onClick: () =>
                  settle.mutate({ id: session.id, settled: false }),
              },
            }),
        }),
      onError: (e) => toast.error(e.message, { id, duration: 12000 }),
    });
  };
}

// Archive from a session's menu: puts it away; Unarchive brings it back.
export function useArchiveAction() {
  const archive = useArchiveSession();
  const unarchive = useUnarchiveSession();
  return (session: Session) =>
    archive.mutate(session.id, {
      onSuccess: () =>
        toast.success(`Archived ${session.name}`, {
          action: {
            label: "Undo",
            onClick: () => unarchive.mutate(session.id),
          },
        }),
      onError: (e) => toast.error(e.message, { duration: 12000 }),
    });
}
