"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import {
  Circle,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Eye,
  Send,
  X,
  ChevronDown,
  ChevronRight,
  GitBranch,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type WorkerStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "dead";

export interface WorkerInfo {
  id: string;
  name: string;
  task: string;
  status: WorkerStatus;
  worktreePath: string | null;
  branchName: string | null;
  createdAt: string;
}

interface WorkerCardProps {
  worker: WorkerInfo;
  isExpanded?: boolean;
  output?: string;
  onToggleExpand?: () => void;
  onViewOutput?: () => void;
  onSendMessage?: (message: string) => void;
  onKill?: () => void;
  onAttach?: () => void;
}

const statusConfig: Record<
  WorkerStatus,
  { icon: typeof Circle; color: string; label: string }
> = {
  pending: { icon: Circle, color: "text-muted-foreground", label: "Pending" },
  running: { icon: Loader2, color: "text-green-500", label: "Running" },
  waiting: { icon: AlertCircle, color: "text-yellow-500", label: "Waiting" },
  idle: { icon: Circle, color: "text-muted-foreground", label: "Idle" },
  completed: { icon: CheckCircle, color: "text-green-500", label: "Completed" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  dead: { icon: XCircle, color: "text-red-500", label: "Dead" },
};

export function WorkerCard({
  worker,
  isExpanded = false,
  output,
  onToggleExpand,
  onViewOutput,
  onSendMessage,
  onKill,
  onAttach,
}: WorkerCardProps) {
  const [message, setMessage] = useState("");
  const [showSendInput, setShowSendInput] = useState(false);

  const config = statusConfig[worker.status];
  const StatusIcon = config.icon;
  const isActive = worker.status === "running" || worker.status === "waiting";

  const handleSend = () => {
    if (message.trim() && onSendMessage) {
      onSendMessage(message.trim());
      setMessage("");
      setShowSendInput(false);
    }
  };

  return (
    <div
      className={cn(
        "bg-card rounded-lg border transition-colors",
        isActive && "border-primary/30",
        worker.status === "completed" && "border-green-500/30 bg-green-500/5",
        worker.status === "failed" && "border-red-500/30 bg-red-500/5"
      )}
    >
      {/* Header */}
      <div
        className="hover:bg-accent/30 flex cursor-pointer items-center gap-2 p-3"
        onClick={onToggleExpand}
      >
        <button className="p-0.5">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-3 w-3" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3 w-3" />
          )}
        </button>

        <StatusIcon
          className={cn(
            "h-4 w-4 flex-shrink-0",
            config.color,
            worker.status === "running" && "animate-spin"
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{worker.name}</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                config.color,
                "bg-current/10"
              )}
            >
              {config.label}
            </span>
          </div>
          {worker.branchName && (
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
              <GitBranch className="h-3 w-3" />
              <span className="truncate">{worker.branchName}</span>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {isActive && onAttach && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onAttach}>
                  <Eye className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach to terminal</TooltipContent>
            </Tooltip>
          )}
          {isActive && onKill && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onKill}
                  className="text-red-500 hover:text-red-400"
                >
                  <X className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Kill worker</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-border/50 space-y-2 border-t px-3 pb-3">
          {/* Task */}
          <div className="pt-2">
            <div className="text-muted-foreground mb-1 text-xs">Task:</div>
            <div className="bg-muted/30 rounded p-2 font-mono text-sm text-xs">
              {worker.task}
            </div>
          </div>

          {/* Output preview */}
          {output && (
            <div>
              <div className="text-muted-foreground mb-1 text-xs">
                Recent output:
              </div>
              <pre className="bg-muted/30 max-h-32 overflow-x-auto overflow-y-auto rounded p-2 font-mono text-xs whitespace-pre-wrap">
                {output.slice(-500)}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {onViewOutput && (
              <Button variant="outline" size="sm" onClick={onViewOutput}>
                <Eye className="mr-1 h-3 w-3" />
                Full output
              </Button>
            )}

            {isActive && onSendMessage && !showSendInput && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSendInput(true)}
              >
                <Send className="mr-1 h-3 w-3" />
                Send input
              </Button>
            )}
          </div>

          {/* Send input form */}
          {showSendInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                  if (e.key === "Escape") setShowSendInput(false);
                }}
                placeholder="Type message..."
                className="bg-muted/50 focus:bg-muted focus:ring-primary/50 flex-1 rounded px-2 py-1 text-sm focus:ring-1 focus:outline-none"
                autoFocus
              />
              <Button size="sm" onClick={handleSend}>
                Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSendInput(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
