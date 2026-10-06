"use client";

import { useState } from "react";
import { ExternalLink, KanbanSquare, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskState, TaskView } from "@/lib/tasks";
import { isFinished } from "@/lib/tasks/state";
import { useDropTask, useSignOffTask } from "@/data/tasks";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { tasksUiActions } from "@/stores/tasksUi";
import { cn } from "@/lib/utils";

const STATE: Record<TaskState, { label: string; tone: string }> = {
  working: { label: "Working", tone: "text-muted-foreground" },
  "needs-input": {
    label: "Needs input",
    tone: "text-amber-600 dark:text-amber-400",
  },
  blocked: { label: "Blocked", tone: "text-amber-600 dark:text-amber-400" },
  review: { label: "Ready for review", tone: "text-primary" },
  "checks-failing": { label: "Checks failing", tone: "text-destructive" },
  exited: { label: "Agent exited", tone: "text-amber-600 dark:text-amber-400" },
  merged: { label: "Merged", tone: "text-emerald-600 dark:text-emerald-400" },
  dropped: { label: "Dropped", tone: "text-muted-foreground/60" },
  done: { label: "Done", tone: "text-emerald-600 dark:text-emerald-400" },
};

export function TaskRow({ task }: { task: TaskView }) {
  const signOff = useSignOffTask();
  const drop = useDropTask();
  const [confirmDrop, setConfirmDrop] = useState(false);
  const live = !isFinished(task.state);
  const error = signOff.error?.message || drop.error?.message;

  return (
    <div className="bg-foreground/[0.03] space-y-2 rounded-xl px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.name}</p>
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {task.projectName} · {task.branch}
          </p>
          {task.cardUrl && (
            <a
              href={task.cardUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center gap-1 text-[11px]"
            >
              <KanbanSquare className="h-3 w-3" />
              Card
            </a>
          )}
        </div>
        <span
          className={cn("shrink-0 text-xs font-medium", STATE[task.state].tone)}
        >
          {STATE[task.state].label}
        </span>
      </div>

      {live && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              tmuxAttachActions.request(task.tmuxName, "local");
              tasksUiActions.setPanelOpen(false);
            }}
          >
            <SquareTerminal className="h-3.5 w-3.5" />
            Open
          </Button>
          {task.pr && (
            <Button size="sm" variant="outline" asChild>
              <a href={task.pr.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                PR #{task.pr.number}
              </a>
            </Button>
          )}
          <span className="flex-1" />
          {confirmDrop ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={drop.isPending}
              onClick={() => drop.mutate(task.id)}
            >
              {drop.isPending ? "Dropping..." : "Confirm drop"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDrop(true)}
            >
              Drop
            </Button>
          )}
          {task.state === "review" && (
            <Button
              size="sm"
              disabled={signOff.isPending}
              onClick={() => signOff.mutate(task.id)}
            >
              {signOff.isPending ? "Merging..." : "Sign off & merge"}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
