"use client";

import { useEnvFailures } from "@/data/health";
import { ClassRow } from "./ClassRow";

// Environment failures sessions hit (wrong Python, refused writes, lost
// permissions): how many sessions per class and project, and who.
export function EnvFailures() {
  const { data, isPending, error } = useEnvFailures();
  const hit = data?.classes.filter((c) => c.sessions30 > 0) ?? [];
  const quiet = data?.classes.filter((c) => c.sessions30 === 0) ?? [];
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Sessions that hit a known environment failure, once per session and
        class. Each gets the fix once; the orchestrator hears when a class
        spikes or comes back.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
      {isPending && (
        <div className="bg-muted/40 h-24 animate-pulse rounded-xl" />
      )}
      {data && hit.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No environment failures in the last 30 days.
        </p>
      )}
      {hit.length > 0 && (
        <ul className="border-border/60 overflow-hidden rounded-xl border">
          {hit.map((c) => (
            <ClassRow key={c.id} view={c} />
          ))}
        </ul>
      )}
      {quiet.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Watching, no hits: {quiet.map((c) => c.label).join(", ")}.
        </p>
      )}
    </div>
  );
}
