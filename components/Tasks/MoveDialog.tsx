"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Check, Circle, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSessionsQuery } from "@/data/sessions";
import { useMoveProgress, useMoveSession } from "@/data/tasks";
import type { MoveStepState } from "@/lib/tasks/move-progress";
import { cn } from "@/lib/utils";
import { moveUi, moveUiActions } from "@/stores/moveUi";
import { sessionOpenActions } from "@/stores/sessionOpen";

const STEP_ICON: Record<MoveStepState, React.ReactNode> = {
  pending: <Circle className="text-muted-foreground/50 h-3.5 w-3.5" />,
  active: <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />,
  done: (
    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
  ),
  failed: <X className="text-destructive h-3.5 w-3.5" />,
};

// One move at a time, wherever it was started: its steps while it runs,
// then where the task runs now, or why it didn't move and what to do.
export function MoveDialog() {
  const { job, open } = useSnapshot(moveUi);
  const running = job?.phase === "moving" || job?.phase === "lost";
  const { data: progress } = useMoveProgress(job?.sessionId ?? null, running);
  const { data } = useSessionsQuery();
  const move = useMoveSession();
  const now = data?.sessions.find((s) => s.id === job?.sessionId);

  // The request dropped: the server's progress says how it ended.
  useEffect(() => {
    if (job?.phase !== "lost" || progress === undefined) return;
    if (progress === null || progress.finished)
      moveUiActions.settle(job.sessionId, {
        phase: progress && !progress.error ? "done" : "failed",
        error: progress
          ? progress.error
          : "Lost touch with the move. Check where the task is in the session list.",
        arrivedId: null,
      });
  }, [job?.phase, job?.sessionId, progress]);

  if (!job) return null;
  const paused = job.phase === "failed" && now?.task_status === "moving";
  const title =
    job.phase === "done"
      ? `Now running on ${job.to}`
      : job.phase === "failed"
        ? "The move didn't finish"
        : `Moving to ${job.to}`;

  return (
    <Dialog open={open} onOpenChange={moveUiActions.setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{job.name}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-2">
          {(progress?.steps ?? []).map((s) => (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-2.5 text-sm",
                s.state === "pending" && "text-muted-foreground"
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {STEP_ICON[s.state]}
              </span>
              {s.label}
            </li>
          ))}
          {!progress && running && (
            <li className="text-muted-foreground flex items-center gap-2.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting
            </li>
          )}
        </ol>
        {job.phase === "failed" && (
          <div className="space-y-1.5 text-sm">
            {job.error && <p className="text-destructive">{job.error}</p>}
            <p className="text-muted-foreground">
              {paused
                ? "It's paused partway with its agent stopped. Move again finishes it, or Resume here in Tasks carries on here."
                : `Nothing moved: it's still where it was, on ${job.from}.`}
            </p>
          </div>
        )}
        <DialogFooter className="gap-2">
          {job.phase === "done" && job.arrivedId && (
            <Button
              className="h-11 sm:h-9"
              onClick={() => {
                sessionOpenActions.request(job.arrivedId!);
                moveUiActions.setOpen(false);
              }}
            >
              Open it
            </Button>
          )}
          {paused && (
            <Button
              className="h-11 sm:h-9"
              onClick={() =>
                move(
                  { id: job.sessionId, name: job.name, hostId: now!.host_id },
                  { hostId: job.toHostId, name: job.to, label: "" }
                )
              }
            >
              Move again
            </Button>
          )}
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            onClick={() => moveUiActions.setOpen(false)}
          >
            {running ? "Hide" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
