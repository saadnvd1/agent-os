"use client";

import { cn } from "@/lib/utils";
import { Wrench, Check, X, Loader2 } from "lucide-react";

interface ToolCallDisplayProps {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "completed" | "error";
}

export function ToolCallDisplay({
  name,
  input,
  output,
  status,
}: ToolCallDisplayProps) {
  const StatusIcon = {
    pending: Loader2,
    running: Loader2,
    completed: Check,
    error: X,
  }[status];

  return (
    <div className="ml-11 my-2 border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          status === "error" ? "bg-destructive/10" : "bg-muted/50"
        )}
      >
        <Wrench className="w-4 h-4 text-muted-foreground" />
        <span className="font-mono text-sm">{name}</span>
        <StatusIcon
          className={cn(
            "w-4 h-4 ml-auto",
            status === "running" && "animate-spin text-yellow-400",
            status === "pending" && "animate-spin text-muted-foreground",
            status === "completed" && "text-primary",
            status === "error" && "text-destructive"
          )}
        />
      </div>

      {/* Input */}
      <details className="group">
        <summary className="px-3 py-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
          Input
        </summary>
        <pre className="px-3 py-2 text-xs text-muted-foreground bg-background overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      </details>

      {/* Output */}
      {output && (
        <details className="group" open={status === "completed"}>
          <summary className="px-3 py-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Output
          </summary>
          <pre className="px-3 py-2 text-xs text-muted-foreground bg-background overflow-x-auto max-h-48">
            {output.length > 1000 ? output.slice(0, 1000) + "..." : output}
          </pre>
        </details>
      )}
    </div>
  );
}
