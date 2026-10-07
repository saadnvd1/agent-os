"use client";

import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskView } from "@/lib/tasks";
import { useLinkedHosts } from "@/data/hosts";
import { useMoveTask } from "@/data/tasks";

// Carry the task on elsewhere: from here to a linked machine, or back here.
export function MoveTaskButton({
  task,
  onError,
}: {
  task: TaskView;
  onError: (message: string | null) => void;
}) {
  const machines = useLinkedHosts();
  const move = useMoveTask();
  const targets = task.hostId
    ? [{ id: "local", label: "Move here" }]
    : machines.map((h) => ({ id: h.id, label: `Move to ${h.name}` }));
  if (!task.branch) return null;

  return targets.map((t) => (
    <Button
      key={t.id}
      size="sm"
      variant="outline"
      className="h-11 sm:h-8"
      disabled={move.isPending}
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
  ));
}
