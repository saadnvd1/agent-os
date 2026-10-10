"use client";

import { useWorkspacesQuery } from "@/data/workspaces";
import { TaskLimitForm } from "./TaskLimitForm";

// Settings > Workspaces: each workspace's own settings.
export function WorkspaceSettings() {
  const { data: workspaces, isPending, isError, error } = useWorkspacesQuery();

  if (isPending)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  if (!workspaces.length)
    return (
      <p className="text-muted-foreground text-sm">
        No workspaces yet. Make one from the workspace menu at the top of the
        sidebar.
      </p>
    );

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Running task limit: tasks over it wait in the Queued list and start by
        themselves, in order, when a running one finishes.
      </p>
      {workspaces.map((w) => (
        <section
          key={w.id}
          aria-label={w.name}
          className="bg-muted/40 space-y-3 rounded-lg px-3 py-3"
        >
          <h3 className="truncate text-sm font-medium">{w.name}</h3>
          <TaskLimitForm
            key={`${w.id}:${w.max_running_tasks ?? "off"}`}
            workspace={w}
          />
        </section>
      ))}
    </div>
  );
}
