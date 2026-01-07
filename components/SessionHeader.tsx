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

export function SessionHeader({ session, onFork, onDelete }: SessionHeaderProps) {
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold truncate">{session.name}</h1>
          <Badge variant={statusVariants[session.status]} className="text-xs">
            {session.status}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <FolderOpen className="w-3 h-3" />
          <span className="truncate">{session.working_directory}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onFork} title="Fork session">
          <GitFork className="w-4 h-4 mr-1" />
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
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
