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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";

export type WorkerStatus = "pending" | "running" | "waiting" | "idle" | "completed" | "failed" | "dead";

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

const statusConfig: Record<WorkerStatus, { icon: typeof Circle; color: string; label: string }> = {
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
    <div className={cn(
      "rounded-lg border bg-card transition-colors",
      isActive && "border-primary/30",
      worker.status === "completed" && "border-green-500/30 bg-green-500/5",
      worker.status === "failed" && "border-red-500/30 bg-red-500/5",
    )}>
      {/* Header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-accent/30"
        onClick={onToggleExpand}
      >
        <button className="p-0.5">
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </button>

        <StatusIcon className={cn(
          "w-4 h-4 flex-shrink-0",
          config.color,
          worker.status === "running" && "animate-spin"
        )} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{worker.name}</span>
            <span className={cn("text-xs px-1.5 py-0.5 rounded", config.color, "bg-current/10")}>
              {config.label}
            </span>
          </div>
          {worker.branchName && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <GitBranch className="w-3 h-3" />
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
                  <Eye className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach to terminal</TooltipContent>
            </Tooltip>
          )}
          {isActive && onKill && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onKill} className="text-red-500 hover:text-red-400">
                  <X className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Kill worker</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50">
          {/* Task */}
          <div className="pt-2">
            <div className="text-xs text-muted-foreground mb-1">Task:</div>
            <div className="text-sm bg-muted/30 rounded p-2 font-mono text-xs">
              {worker.task}
            </div>
          </div>

          {/* Output preview */}
          {output && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Recent output:</div>
              <pre className="text-xs bg-muted/30 rounded p-2 font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                {output.slice(-500)}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {onViewOutput && (
              <Button variant="outline" size="sm" onClick={onViewOutput}>
                <Eye className="w-3 h-3 mr-1" />
                Full output
              </Button>
            )}

            {isActive && onSendMessage && !showSendInput && (
              <Button variant="outline" size="sm" onClick={() => setShowSendInput(true)}>
                <Send className="w-3 h-3 mr-1" />
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
                className="flex-1 text-sm px-2 py-1 rounded bg-muted/50 focus:bg-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
                autoFocus
              />
              <Button size="sm" onClick={handleSend}>Send</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSendInput(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
