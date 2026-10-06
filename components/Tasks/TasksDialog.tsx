"use client";

import { useSnapshot } from "valtio";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTasksQuery } from "@/data/tasks";
import { needsHuman } from "@/lib/tasks/state";
import { tasksUi, tasksUiActions } from "@/stores/tasksUi";
import { TaskRow } from "./TaskRow";
import { BoardTodoSection } from "@/components/LumifyHub";
import { StacksSection } from "@/components/Stacks";

export function TasksDialog() {
  const { panelOpen } = useSnapshot(tasksUi);
  const { data: tasks = [], isPending } = useTasksQuery();
  const active = tasks.filter(
    (t) => t.state !== "merged" && t.state !== "dropped"
  );
  // Whatever needs a human first.
  active.sort(
    (a, b) => Number(needsHuman(b.state)) - Number(needsHuman(a.state))
  );
  const done = tasks.filter((t) => !active.includes(t)).slice(0, 10);

  return (
    <Dialog open={panelOpen} onOpenChange={tasksUiActions.setPanelOpen}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto [&>*]:min-w-0">
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <DialogTitle>Tasks</DialogTitle>
          <Button size="sm" className="mr-6" onClick={tasksUiActions.openNew}>
            <Plus className="h-4 w-4" />
            New task
          </Button>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}

export function useTasksNeedingYou(): number {
  const { data: tasks = [] } = useTasksQuery();
  return tasks.filter((t) => needsHuman(t.state)).length;
}
