"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Workspace } from "@/lib/db";
import { useUpdateWorkspace } from "@/data/workspaces";
import { parseTaskLimit } from "./task-limit";

// How many tasks the workspace runs at once. Off by default; over the limit
// a new task is queued and starts by itself when one finishes.
export function TaskLimitForm({ workspace }: { workspace: Workspace }) {
  const update = useUpdateWorkspace();
  const current = workspace.max_running_tasks;
  const [on, setOn] = useState(current !== null);
  const [text, setText] = useState(String(current ?? 3));
  const parsed = parseTaskLimit(on, text);
  const dirty = !("error" in parsed) && parsed.limit !== current;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if ("error" in parsed) return;
        update.mutate(
          { id: workspace.id, maxRunningTasks: parsed.limit },
          {
            onSuccess: () =>
              toast.success(
                parsed.limit
                  ? `Up to ${parsed.limit} tasks run at once`
                  : "No running task limit"
              ),
            onError: (error) => toast.error(error.message),
          }
        );
      }}
      className="space-y-4"
    >
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm md:min-h-9">
        Limit running tasks
        <Switch
          checked={on}
          onCheckedChange={setOn}
          aria-label="Limit running tasks"
        />
      </label>
      {on && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>At most</span>
          <span className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Running task limit"
              aria-invalid={"error" in parsed}
              className="h-11 w-20 text-base sm:h-9 md:text-sm"
            />
            <span className="text-muted-foreground">at a time</span>
          </span>
        </label>
      )}
      {"error" in parsed && (
        <p className="text-destructive text-xs">{parsed.error}</p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-11 sm:h-8"
          disabled={"error" in parsed || !dirty || update.isPending}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
