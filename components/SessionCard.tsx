"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { GitFork, GitBranch, GitPullRequest, Circle, AlertCircle, Loader2, MoreHorizontal, FolderInput, Trash2, Copy, Pencil, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { Session, Group } from "@/lib/db";
import type { AgentType } from "@/lib/providers";

type TmuxStatus = "idle" | "running" | "waiting" | "error" | "dead";

// Agent badge colors and labels
const agentBadgeConfig: Record<AgentType, { label: string; bgClass: string }> = {
  claude: { label: "C", bgClass: "bg-orange-500/20 text-orange-400" },
  codex: { label: "X", bgClass: "bg-green-500/20 text-green-400" },
  opencode: { label: "O", bgClass: "bg-blue-500/20 text-blue-400" },
};

interface SessionCardProps {
  session: Session;
  isActive?: boolean;
  tmuxStatus?: TmuxStatus;
  groups?: Group[];
  onClick?: () => void;
  onMove?: (groupPath: string) => void;
  onFork?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  onCreatePR?: () => void;
}

const statusConfig: Record<TmuxStatus, { color: string; label: string; icon: React.ReactNode }> = {
  idle: {
    color: "text-muted-foreground",
    label: "idle",
    icon: <Circle className="w-2 h-2 fill-current" />
  },
  running: {
    color: "text-blue-500",
    label: "running",
    icon: <Loader2 className="w-3 h-3 animate-spin" />
  },
  waiting: {
    color: "text-yellow-500 animate-pulse",
    label: "waiting",
    icon: <AlertCircle className="w-3 h-3" />
  },
  error: {
    color: "text-red-500",
    label: "error",
    icon: <Circle className="w-2 h-2 fill-current" />
  },
  dead: {
    color: "text-muted-foreground/50",
    label: "stopped",
    icon: <Circle className="w-2 h-2" />
  },
};

export function SessionCard({ session, isActive, tmuxStatus, groups = [], onClick, onMove, onFork, onDelete, onRename, onCreatePR }: SessionCardProps) {
  const timeAgo = getTimeAgo(session.updated_at);
  const status = tmuxStatus || "dead";
  const config = statusConfig[status];
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    if (editName.trim() && editName !== session.name && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  return (
    <div
      onClick={isEditing ? undefined : onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md transition-colors overflow-hidden cursor-pointer group flex items-center gap-2",
        isActive
          ? "bg-primary/10"
          : "hover:bg-accent/50",
        status === "waiting" && !isActive && "bg-yellow-500/5"
      )}
    >
      {/* Agent type badge */}
      {session.agent_type && (
        <span
          className={cn(
            "flex-shrink-0 text-[9px] font-bold px-1 rounded",
            agentBadgeConfig[session.agent_type]?.bgClass || agentBadgeConfig.claude.bgClass
          )}
          title={session.agent_type}
        >
          {agentBadgeConfig[session.agent_type]?.label || "C"}
        </span>
      )}

      {/* Status indicator */}
      <div className={cn("flex-shrink-0", config.color)} title={config.label}>
        {config.icon}
      </div>

      {/* Session name */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setEditName(session.name);
              setIsEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-sm bg-transparent border-b border-primary outline-none min-w-0"
        />
      ) : (
        <span className="flex-1 text-sm truncate min-w-0">
          {session.name}
        </span>
      )}

      {/* Fork indicator */}
      {session.parent_session_id && (
        <GitFork className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      )}

      {/* Branch indicator for worktree sessions */}
      {session.branch_name && (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground flex-shrink-0" title={session.branch_name}>
          <GitBranch className="w-3 h-3" />
          <span className="max-w-[60px] truncate">{session.branch_name.replace("feature/", "")}</span>
        </span>
      )}

      {/* Port indicator for worktree sessions */}
      {session.dev_server_port && (
        <span className="text-[10px] text-muted-foreground flex-shrink-0" title={`Dev server port: ${session.dev_server_port}`}>
          :{session.dev_server_port}
        </span>
      )}

      {/* PR status badge */}
      {session.pr_status && (
        <a
          href={session.pr_url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex items-center gap-0.5 text-[10px] px-1 rounded flex-shrink-0",
            session.pr_status === "open" && "bg-green-500/20 text-green-400",
            session.pr_status === "merged" && "bg-purple-500/20 text-purple-400",
            session.pr_status === "closed" && "bg-red-500/20 text-red-400"
          )}
          title={`PR #${session.pr_number}: ${session.pr_status}`}
        >
          <GitPullRequest className="w-2.5 h-2.5" />
          <span>{session.pr_status === "merged" ? "M" : session.pr_status === "closed" ? "X" : "O"}</span>
        </a>
      )}

      {/* Time ago */}
      <span className="text-[10px] text-muted-foreground flex-shrink-0 hidden group-hover:hidden sm:block">
        {timeAgo}
      </span>

      {/* Actions menu */}
      {(onMove || onFork || onDelete || onRename || onCreatePR) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 h-5 w-5 flex-shrink-0">
              <MoreHorizontal className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
              >
                <Pencil className="w-3 h-3 mr-2" />
                Rename
              </DropdownMenuItem>
            )}
            {onFork && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onFork();
                }}
              >
                <Copy className="w-3 h-3 mr-2" />
                Fork session
              </DropdownMenuItem>
            )}
            {onCreatePR && session.branch_name && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  if (session.pr_url) {
                    window.open(session.pr_url, "_blank");
                  } else {
                    onCreatePR();
                  }
                }}
              >
                <GitPullRequest className="w-3 h-3 mr-2" />
                {session.pr_url ? "Open PR" : "Create PR"}
              </DropdownMenuItem>
            )}
            {onMove && groups.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="w-3 h-3 mr-2" />
                  Move to...
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {groups
                    .filter((g) => g.path !== session.group_path)
                    .map((group) => (
                      <DropdownMenuItem
                        key={group.path}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(group.path);
                        }}
                      >
                        {group.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="text-red-500 focus:text-red-500"
                >
                  <Trash2 className="w-3 h-3 mr-2" />
                  Delete session
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr + "Z"); // Assume UTC
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
