"use client";

import { ArrowRightLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskView } from "@/lib/tasks";
import { useLinkedHosts } from "@/data/hosts";
import { useMoveTask, useResumeTask } from "@/data/tasks";

// Carry the task on elsewhere: from here to a linked machine, or back here.
// One stopped partway ("moving") can be moved again or resumed here.
export function MoveTaskButton({
  task,
  onError,
}: {
  task: TaskView;
  onError: (message: string | null) => void;
}) {
  const machines = useLinkedHosts();
  const move = useMoveTask();
  const resume = useResumeTask();
  const targets = task.hostId
    ? [{ id: "local", label: "Move here" }]
    : machines.map((h) => ({ id: h.id, label: `Move to ${h.name}` }));
  if (!task.branch) return null;
  const busy = move.isPending || resume.isPending;
  // Resuming without the other machine's word is the user's call.
  const unsure = /Resume anyway/.test(resume.error?.message ?? "");
  const stuckHere = task.state === "moving" && !task.hostId;

  return (
    <>
      {targets.map((t) => (
        <Button
          key={t.id}
          size="sm"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={busy}
          onClick={() => {
            onError(null);
            move.mutate(
              { id: task.id, hostId: t.id },
              { onError: (e) => onError(e.message) }
            );
          }}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          {move.isPending && move.variables?.hostId === t.id
            ? "Moving..."
            : t.label}
        </Button>
      ))}
      {stuckHere && (
        <Button
          size="sm"
          variant={unsure ? "destructive" : "outline"}
          className="h-11 sm:h-8"
          disabled={busy}
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
