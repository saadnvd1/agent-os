"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTasksQuery } from "@/data/tasks";
import { isFinished, needsHuman } from "@/lib/tasks/state";
import { inboxUiActions } from "@/stores/inboxUi";
import { newDraft } from "@/stores/drafts";
import { TaskRow } from "./TaskRow";
import { BoardTodoSection } from "@/components/LumifyHub";
import { StacksSection } from "@/components/Stacks";
import { FeaturesSection } from "@/components/Features";

export function TasksPanel() {
  const { data: tasks = [], isPending } = useTasksQuery();
  const active = tasks.filter((t) => !isFinished(t.state));
  // Whatever needs a human first.
  active.sort(
    (a, b) => Number(needsHuman(b.state)) - Number(needsHuman(a.state))
  );
  const done = tasks.filter((t) => !active.includes(t)).slice(0, 10);

  return (
    <div className="space-y-3 [&>*]:min-w-0">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            inboxUiActions.setOpen(false);
            newDraft({ kind: "current", openPr: true });
          }}
        >
          <Plus className="h-4 w-4" />
          New task
        </Button>
      </div>
      {isPending && (
        <div className="bg-muted/40 h-16 animate-pulse rounded-xl" />
      )}
      {!isPending && tasks.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No tasks yet. Start one and keep working while it runs.
        </p>
      )}
      <div className="space-y-2">
        {active.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
      <FeaturesSection />
      <StacksSection />
      <BoardTodoSection />
      {done.length > 0 && (
        <div className="space-y-2">
          <p className="label-mono text-muted-foreground pt-2">Finished</p>
          {done.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}
