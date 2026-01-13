"use client";

import { useState } from "react";
import { ChevronDown, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { DevServerCard } from "./DevServerCard";
import type { DevServer, Project } from "@/lib/db";

interface DevServersSectionProps {
  servers: DevServer[];
  projects: Project[];
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onViewLogs: (id: string) => void;
}

export function DevServersSection({
  servers,
  projects,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onViewLogs,
}: DevServersSectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (servers.length === 0) return null;

  // Count running servers
  const runningCount = servers.filter((s) => s.status === "running").length;

  // Create project lookup map
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="border-b border-border/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !expanded && "-rotate-90"
          )}
        />
        <Server className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-left text-sm font-medium">Dev Servers</span>
        {runningCount > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5",
              "text-[10px] font-medium",
              "bg-green-500/20 text-green-500"
            )}
          >
            {runningCount} running
          </span>
        )}
        <span className="text-xs text-muted-foreground">{servers.length}</span>
      </button>

      {/* Server list */}
      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {servers.map((server) => (
            <DevServerCard
              key={server.id}
              server={server}
              projectName={projectMap.get(server.project_id)?.name}
              onStart={onStart}
              onStop={onStop}
              onRestart={onRestart}
              onRemove={onRemove}
              onViewLogs={onViewLogs}
            />
          ))}
        </div>
      )}
    </div>
  );
}
