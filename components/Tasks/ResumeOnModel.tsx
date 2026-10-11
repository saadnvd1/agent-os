"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSelect } from "@/components/Models/ModelSelect";
import { useModelsQuery, useResumeOnModel } from "@/data/models";
import type { TaskView } from "@/lib/tasks";

// "Resume on model…": the task carries on in the same conversation and
// worktree on the model picked, which it keeps from then on.
export function ResumeOnModel({ task }: { task: TaskView }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const models = useModelsQuery(open);
  const resume = useResumeOnModel();
  if (!open)
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-11 md:h-8"
        title={task.model ? `Runs on ${task.model}` : undefined}
        onClick={() => setOpen(true)}
      >
        <Cpu className="h-3.5 w-3.5" />
        Resume on model…
      </Button>
    );
  return (
    <div className="bg-muted/40 w-full space-y-2 rounded-lg p-2">
      <p className="text-muted-foreground text-xs">
        Now on {task.model ?? "its role's model"}
        {task.planning ? ", planning" : ""}. Its conversation and worktree carry
        on.
      </p>
      <ModelSelect
        value={ref}
        effective={models.data?.effective}
        disabled={!models.data || resume.isPending}
        onChange={setRef}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={!ref || resume.isPending}
          onClick={() =>
            ref &&
            resume.mutate(
              { taskId: task.id, model: ref },
              { onSuccess: () => setOpen(false) }
            )
          }
        >
          {resume.isPending ? "Resuming…" : "Resume"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 md:h-8"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {resume.isError && (
        <p className="text-destructive text-xs">{resume.error.message}</p>
      )}
    </div>
  );
}
