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
    <div className="border-border my-2 ml-11 overflow-hidden rounded-lg border">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          status === "error" ? "bg-destructive/10" : "bg-muted/50"
        )}
      >
        <Wrench className="text-muted-foreground h-4 w-4" />
        <span className="font-mono text-sm">{name}</span>
        <StatusIcon
          className={cn(
            "ml-auto h-4 w-4",
            status === "running" && "animate-spin text-yellow-400",
            status === "pending" && "text-muted-foreground animate-spin",
            status === "completed" && "text-primary",
            status === "error" && "text-destructive"
          )}
        />
      </div>

      {/* Input */}
      <details className="group">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-1 text-xs">
          Input
        </summary>
        <pre className="text-muted-foreground bg-background overflow-x-auto px-3 py-2 text-xs">
          {JSON.stringify(input, null, 2)}
        </pre>
      </details>

      {/* Output */}
      {output && (
        <details className="group" open={status === "completed"}>
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-1 text-xs">
            Output
          </summary>
          <pre className="text-muted-foreground bg-background max-h-48 overflow-x-auto px-3 py-2 text-xs">
            {output.length > 1000 ? output.slice(0, 1000) + "..." : output}
          </pre>
        </details>
      )}
    </div>
  );
}
