import { toast } from "sonner";
import type { Session } from "@/lib/db";
import {
  useArchiveSession,
  useDoneSession,
  useResurrectSession,
  useUnarchiveSession,
} from "@/data/done";
import { useSettleSession } from "@/data/sessions/shelf";

// Done from a session's menu: an open PR merges through the gates, after an
// in-app confirmation; a failing gate comes back as an error toast naming it.
export function useDoneAction() {
  const done = useDoneSession();
  const settle = useSettleSession();
  const run = (session: Session, merges: boolean) => {
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
  return (session: Session) => {
    const merges =
      session.task_status === "running" && session.pr_status === "open";
    if (!merges) return run(session, false);
    // Merging is the one Done that can't be undone: asked in the app, not
    // with confirm(), which a webview drops.
    toast(`Merge ${session.name}'s PR and finish it?`, {
      description:
        "It merges only through the orchestrator's gates; a failing gate refuses and nothing merges.",
      duration: 15000,
      action: { label: "Merge", onClick: () => run(session, true) },
      cancel: { label: "Cancel", onClick: () => {} },
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

// Restore from a session's menu: the same conversation, its worktree back.
export function useResurrectAction() {
  const resurrect = useResurrectSession();
  return (session: Session) => {
    const id = toast.loading(`Restoring ${session.name}…`);
    resurrect.mutate(session.id, {
      onSuccess: (outcome) =>
        toast.success(outcome.text, { id, duration: 8000 }),
      onError: (e) => toast.error(e.message, { id, duration: 12000 }),
    });
  };
}
