"use client";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { GitFork, Trash2, FolderOpen } from "lucide-react";
import type { Session } from "@/lib/db";

interface SessionHeaderProps {
  session: Session;
  onFork: () => void;
  onDelete?: () => void;
}

const statusVariants: Record<
  Session["status"],
  "default" | "success" | "warning" | "destructive"
> = {
  idle: "default",
  running: "success",
  waiting: "warning",
  error: "destructive",
};

export function SessionHeader({
  session,
  onFork,
  onDelete,
}: SessionHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate font-semibold">{session.name}</h1>
          <Badge variant={statusVariants[session.status]} className="text-xs">
            {session.status}
          </Badge>
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <FolderOpen className="h-3 w-3" />
          <span className="truncate">{session.working_directory}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onFork} title="Fork session">
          <GitFork className="mr-1 h-4 w-4" />
          Fork
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            title="Delete session"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
