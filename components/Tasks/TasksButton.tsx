"use client";

import { ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tasksUiActions } from "@/stores/tasksUi";
import { useTasksNeedingYou } from "./useTasksNeedingYou";

export function TasksButton({ labelClassName }: { labelClassName?: string }) {
  const waiting = useTasksNeedingYou();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Tasks"
      title="Tasks"
      className="h-7 px-2"
      onClick={tasksUiActions.openPanel}
    >
      <ListTodo className="h-4 w-4" />
      <span className={labelClassName}>Tasks</span>
      {waiting > 0 && (
        <span className="bg-primary text-primary-foreground rounded-full px-1.5 font-mono text-[10px] leading-4 tabular-nums">
          {waiting}
        </span>
      )}
    </Button>
  );
}
