"use client";

import { useState, useRef, useEffect } from "react";
import { SessionCard } from "./SessionCard";
import { NewSessionDialog } from "./NewSessionDialog";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Plus, RefreshCw, Bot, TerminalSquare, Circle, Loader2, AlertCircle, ChevronRight, ChevronDown, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session, Group } from "@/lib/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
}

interface OtherTmuxSession {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  claudeSessionId?: string | null;
}

interface SessionListProps {
  sessions: Session[];
  groups: Group[];
  activeSessionId?: string;
  sessionStatuses?: Record<string, SessionStatus>;
  otherTmuxSessions?: OtherTmuxSession[];
  attachedTmux?: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onTmuxAttach?: (sessionName: string) => void;
  onToggleGroup?: (path: string, expanded: boolean) => void;
  onCreateGroup?: (name: string, parentPath?: string) => void;
  onDeleteGroup?: (path: string) => void;
  onMoveSession?: (sessionId: string, groupPath: string) => void;
  onForkSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  onRenameTmuxSession?: (oldName: string, newName: string) => void;
  onImportTmuxSession?: (sessionName: string, claudeSessionId?: string) => void;
  onCreatePR?: (sessionId: string) => void;
}

export function SessionList({
  sessions,
  groups = [],
  activeSessionId,
  sessionStatuses,
  otherTmuxSessions,
  attachedTmux,
  onSelect,
  onRefresh,
  onTmuxAttach,
  onToggleGroup,
  onCreateGroup,
  onDeleteGroup,
  onMoveSession,
  onForkSession,
  onDeleteSession,
  onRenameSession,
  onRenameTmuxSession,
  onImportTmuxSession,
  onCreatePR,
}: SessionListProps) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroupInput, setShowNewGroupInput] = useState<string | null>(null);
  const [editingTmuxSession, setEditingTmuxSession] = useState<string | null>(null);
  const [editTmuxName, setEditTmuxName] = useState("");
  const [showKillAllConfirm, setShowKillAllConfirm] = useState(false);
  const [killingAll, setKillingAll] = useState(false);
  const tmuxInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTmuxSession && tmuxInputRef.current) {
      tmuxInputRef.current.focus();
      tmuxInputRef.current.select();
    }
  }, [editingTmuxSession]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  const handleKillAll = async () => {
    setKillingAll(true);
    try {
      const res = await fetch("/api/tmux/kill-all", { method: "POST" });
      const data = await res.json();
      if (data.killed > 0) {
        await onRefresh();
      }
    } catch (error) {
      console.error("Failed to kill sessions:", error);
    } finally {
      setKillingAll(false);
      setShowKillAllConfirm(false);
    }
  };

  // Separate workers from regular sessions
  const workersByConduct = sessions.reduce((acc, session) => {
    if (session.conductor_session_id) {
      if (!acc[session.conductor_session_id]) acc[session.conductor_session_id] = [];
      acc[session.conductor_session_id].push(session);
    }
    return acc;
  }, {} as Record<string, Session[]>);

  // Group non-worker sessions by group_path
  const sessionsByGroup = sessions
    .filter(s => !s.conductor_session_id) // Exclude workers
    .reduce((acc, session) => {
      const path = session.group_path || "sessions";
      if (!acc[path]) acc[path] = [];
      acc[path].push(session);
      return acc;
    }, {} as Record<string, Session[]>);

  // Build group hierarchy
  const groupMap = new Map(groups.map(g => [g.path, g]));
  const rootGroups = groups.filter(g => !g.path.includes("/"));

  // Get child groups for a parent
  const getChildGroups = (parentPath: string) => {
    return groups.filter(g => {
      const parts = g.path.split("/");
      parts.pop();
      return parts.join("/") === parentPath;
    });
  };

  // Render a group and its contents recursively
  const renderGroup = (group: Group, level: number = 0) => {
    const groupSessions = sessionsByGroup[group.path] || [];
    const childGroups = getChildGroups(group.path);
    const hasContent = groupSessions.length > 0 || childGroups.length > 0;
    const indent = level * 12; // 12px per level

    const groupHeader = (
      <div
        className="flex items-center gap-1 py-1.5 px-2 rounded hover:bg-accent/50 cursor-pointer group"
        style={{ marginLeft: indent }}
        onClick={() => onToggleGroup?.(group.path, !group.expanded)}
      >
        <button className="p-0.5">
          {group.expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </button>
        <span className="text-sm font-medium flex-1 truncate">{group.name}</span>
        <span className="text-xs text-muted-foreground">{groupSessions.length}</span>

        {/* Group actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 h-6 w-6">
              <MoreHorizontal className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation();
              setShowNewGroupInput(group.path);
            }}>
              <FolderPlus className="w-3 h-3 mr-2" />
              Add subgroup
            </DropdownMenuItem>
            {group.path !== "sessions" && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup?.(group.path);
                }}
                className="text-red-500"
              >
                Delete group
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

    return (
      <div key={group.path} className="space-y-0.5">
        {/* Group header with context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {groupHeader}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setShowNewGroupInput(group.path)}>
              <FolderPlus className="w-3 h-3 mr-2" />
              Add subgroup
            </ContextMenuItem>
            {group.path !== "sessions" && (
              <ContextMenuItem
                onClick={() => onDeleteGroup?.(group.path)}
                className="text-red-500 focus:text-red-500"
              >
                <Trash2 className="w-3 h-3 mr-2" />
                Delete group
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {/* New subgroup input */}
        {showNewGroupInput === group.path && (
          <div className="flex gap-1 px-2" style={{ marginLeft: indent }}>
            <input
              type="text"
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newGroupName.trim()) {
                  onCreateGroup?.(newGroupName.trim(), group.path);
                  setNewGroupName("");
                  setShowNewGroupInput(null);
                } else if (e.key === "Escape") {
                  setNewGroupName("");
                  setShowNewGroupInput(null);
                }
              }}
              className="flex-1 text-sm px-2 py-1 rounded bg-muted/50 focus:bg-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoFocus
            />
          </div>
        )}

        {/* Group contents */}
        {group.expanded && (
          <div
            className="border-l border-border/50 ml-3"
            style={{ marginLeft: indent + 12, paddingLeft: 8 }}
          >
            {/* Child groups */}
            {childGroups.map(child => renderGroup(child, level + 1))}

            {/* Sessions in this group */}
            {groupSessions.map((session) => {
              const workers = workersByConduct[session.id] || [];
              const hasWorkers = workers.length > 0;

              return (
                <div key={session.id} className="space-y-0.5">
                  <div className="flex items-center gap-1">
                    <div className="flex-1 min-w-0">
                      <SessionCard
                        session={session}
                        isActive={session.id === activeSessionId}
                        tmuxStatus={sessionStatuses?.[session.id]?.status}
                        groups={groups}
                        onClick={() => onSelect(session.id)}
                        onMove={onMoveSession ? (groupPath) => onMoveSession(session.id, groupPath) : undefined}
                        onFork={onForkSession ? () => onForkSession(session.id) : undefined}
                        onDelete={onDeleteSession ? () => onDeleteSession(session.id) : undefined}
                        onRename={onRenameSession ? (newName) => onRenameSession(session.id, newName) : undefined}
                        onCreatePR={onCreatePR ? () => onCreatePR(session.id) : undefined}
                      />
                    </div>
                    {/* Workers badge */}
                    {hasWorkers && (
                      <span className="flex-shrink-0 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                        {workers.length}
                      </span>
                    )}
                  </div>

                  {/* Nested workers */}
                  {hasWorkers && (
                    <div className="ml-4 pl-2 border-l border-border/30 space-y-0.5">
                      {workers.map((worker) => (
                        <SessionCard
                          key={worker.id}
                          session={worker}
                          isActive={worker.id === activeSessionId}
                          tmuxStatus={sessionStatuses?.[worker.id]?.status}
                          groups={groups}
                          onClick={() => onSelect(worker.id)}
                          onDelete={onDeleteSession ? () => onDeleteSession(worker.id) : undefined}
                          onRename={onRenameSession ? (newName) => onRenameSession(worker.id, newName) : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">AgentOS</h2>
        </div>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={cn("w-4 h-4", refreshing && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowNewDialog(true)}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New session</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setShowKillAllConfirm(true)}
                className="text-red-500 focus:text-red-500"
              >
                <Trash2 className="w-3 h-3 mr-2" />
                Kill all sessions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Kill All Confirmation */}
      {showKillAllConfirm && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400 mb-2">Kill all tmux sessions?</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={handleKillAll}
              disabled={killingAll}
            >
              {killingAll ? "Killing..." : "Yes, kill all"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowKillAllConfirm(false)}
              disabled={killingAll}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="flex-1 w-full">
        <div className="p-2 space-y-1 max-w-full">
          {sessions.length === 0 && (!otherTmuxSessions || otherTmuxSessions.length === 0) ? (
            <p className="text-center text-muted-foreground text-sm py-8">
              No sessions yet. Create one to get started.
            </p>
          ) : (
            <>
              {/* Grouped sessions */}
              {rootGroups.map(group => renderGroup(group))}

              {/* External tmux sessions */}
              {otherTmuxSessions && otherTmuxSessions.length > 0 && (
                <div className="mt-6 pt-2">
                  <div className="text-xs text-muted-foreground px-2 mb-1">External Sessions</div>
                  <div className="space-y-0.5">
                    {otherTmuxSessions.map((session) => {
                      const isAttached = attachedTmux === session.sessionName;
                      const isEditing = editingTmuxSession === session.sessionName;
                      const statusIcon = session.status === "running"
                        ? <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                        : session.status === "waiting"
                        ? <AlertCircle className="w-3 h-3 text-yellow-500" />
                        : <Circle className="w-2 h-2 text-muted-foreground fill-current" />;

                      const handleRename = () => {
                        if (editTmuxName.trim() && editTmuxName !== session.sessionName && onRenameTmuxSession) {
                          onRenameTmuxSession(session.sessionName, editTmuxName.trim());
                        }
                        setEditingTmuxSession(null);
                      };

                      const hasActions = onRenameTmuxSession || onImportTmuxSession;

                      const sessionContent = (
                        <div
                          onClick={isEditing ? undefined : () => onTmuxAttach?.(session.sessionName)}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded-md transition-colors overflow-hidden flex items-center gap-2 cursor-pointer group",
                            isAttached
                              ? "bg-primary/10"
                              : "hover:bg-accent/50",
                            session.status === "waiting" && !isAttached && "bg-yellow-500/5"
                          )}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex-shrink-0">
                                {statusIcon}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <span className="capitalize">{session.status}</span>
                            </TooltipContent>
                          </Tooltip>
                          <TerminalSquare className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          {isEditing ? (
                            <input
                              ref={tmuxInputRef}
                              type="text"
                              value={editTmuxName}
                              onChange={(e) => setEditTmuxName(e.target.value)}
                              onBlur={handleRename}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRename();
                                if (e.key === "Escape") setEditingTmuxSession(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 text-sm bg-transparent border-b border-primary outline-none min-w-0"
                            />
                          ) : (
                            <span className="flex-1 text-sm truncate">{session.sessionName}</span>
                          )}
                          {hasActions && !isEditing && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 h-5 w-5 flex-shrink-0">
                                  <MoreHorizontal className="w-3 h-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {onRenameTmuxSession && (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditTmuxName(session.sessionName);
                                      setEditingTmuxSession(session.sessionName);
                                    }}
                                  >
                                    <Pencil className="w-3 h-3 mr-2" />
                                    Rename
                                  </DropdownMenuItem>
                                )}
                                {onImportTmuxSession && (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onImportTmuxSession(session.sessionName, session.claudeSessionId || undefined);
                                    }}
                                  >
                                    <Plus className="w-3 h-3 mr-2" />
                                    Import to Sessions
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      );

                      // Wrap with context menu if actions are available
                      if (hasActions) {
                        return (
                          <ContextMenu key={session.sessionName}>
                            <ContextMenuTrigger asChild>
                              {sessionContent}
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              {onRenameTmuxSession && (
                                <ContextMenuItem
                                  onClick={() => {
                                    setEditTmuxName(session.sessionName);
                                    setEditingTmuxSession(session.sessionName);
                                  }}
                                >
                                  <Pencil className="w-3 h-3 mr-2" />
                                  Rename
                                </ContextMenuItem>
                              )}
                              {onImportTmuxSession && (
                                <ContextMenuItem
                                  onClick={() => {
                                    onImportTmuxSession(session.sessionName, session.claudeSessionId || undefined);
                                  }}
                                >
                                  <Plus className="w-3 h-3 mr-2" />
                                  Import to Sessions
                                </ContextMenuItem>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      }

                      return <div key={session.sessionName}>{sessionContent}</div>;
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* New Session Dialog */}
      <NewSessionDialog
        open={showNewDialog}
        groups={groups}
        onClose={() => setShowNewDialog(false)}
        onCreated={(id) => {
          setShowNewDialog(false);
          onSelect(id);
          onRefresh();
        }}
        onCreateGroup={onCreateGroup ? async (name) => {
          await onCreateGroup(name);
          await onRefresh();
        } : undefined}
      />
    </div>
  );
}
