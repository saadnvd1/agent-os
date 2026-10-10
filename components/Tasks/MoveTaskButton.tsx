"use client";

import { ArrowRightLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskView } from "@/lib/tasks";
import { movableTask } from "@/lib/tasks/move-targets";
import { useMoveSession, useMoveTargets, useResumeTask } from "@/data/tasks";

// Carry the task on elsewhere: from here to a linked machine, or back here.
// One stopped partway ("moving") can be moved again or resumed here. The
// move itself shows in MoveDialog.
export function MoveTaskButton({
  task,
  onError,
}: {
  task: TaskView;
  onError: (message: string | null) => void;
}) {
  const targets = useMoveTargets(movableTask(task));
  const move = useMoveSession();
  const resume = useResumeTask();
  if (!task.branch) return null;
  // Resuming without the other machine's word is the user's call.
  const unsure = /Resume anyway/.test(resume.error?.message ?? "");
  const stuckHere = task.state === "moving" && !task.hostId;

  return (
    <>
      {targets.map((t) => (
        <Button
          key={t.hostId}
          size="sm"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={resume.isPending || !!t.blocked}
          onClick={() => {
            onError(null);
            move({ id: task.id, name: task.name, hostId: task.hostId }, t);
          }}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          {t.hostId === "local" ? "Move here" : t.label}
        </Button>
      ))}
      {targets.some((t) => t.blocked) && (
        <span className="text-muted-foreground self-center text-xs">
          {targets[0].blocked}
        </span>
      )}
      {stuckHere && (
        <Button
          size="sm"
          variant={unsure ? "destructive" : "outline"}
          className="h-11 sm:h-8"
          disabled={resume.isPending}
          onClick={() => {
            onError(null);
            resume.mutate(
              { id: task.id, force: unsure },
              { onError: (e) => onError(e.message) }
            );
          }}
        >
          <Play className="h-3.5 w-3.5" />
          {resume.isPending
            ? "Resuming..."
            : unsure
              ? "Resume anyway"
              : "Resume here"}
        </Button>
      )}
    </>
  );
}
