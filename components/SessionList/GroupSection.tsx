"use client";

import { useState } from "react";
import { SessionCard } from "@/components/SessionCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ChevronRight, ChevronDown, FolderPlus, MoreHorizontal, Trash2 } from "lucide-react";
import type { Session, Group } from "@/lib/db";
import type { SessionStatus, SessionHoverHandlers } from "./SessionList.types";

interface GroupSectionProps {
  groups: Group[];
  sessions: Session[];
  activeSessionId?: string;
  sessionStatuses?: Record<string, SessionStatus>;
  summarizingSessionId: string | null;
  workersByConduct: Record<string, Session[]>;
  onToggleGroup: (path: string, expanded: boolean) => void;
  onCreateGroup: (name: string, parentPath?: string) => void;
  onDeleteGroup: (path: string) => void;
  onSelectSession: (sessionId: string) => void;
  onForkSession: (sessionId: string) => void;
  onSummarize: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newName: string) => void;
  hoverHandlers: SessionHoverHandlers;
}

export function GroupSection({
  groups,
  sessions,
  activeSessionId,
  sessionStatuses,
  summarizingSessionId,
  workersByConduct,
  onToggleGroup,
  onCreateGroup,
  onDeleteGroup,
  onSelectSession,
  onForkSession,
  onSummarize,
  onDeleteSession,
  onRenameSession,
  hoverHandlers,
}: GroupSectionProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroupInput, setShowNewGroupInput] = useState<string | null>(null);

  // Group non-worker sessions by group_path
  const sessionsByGroup = sessions
    .filter((s) => !s.conductor_session_id)
    .reduce((acc, session) => {
      const path = session.group_path || "sessions";
      if (!acc[path]) acc[path] = [];
      acc[path].push(session);
      return acc;
    }, {} as Record<string, Session[]>);

  // Build group hierarchy
  const rootGroups = groups.filter((g) => !g.path.includes("/"));

  // Get child groups for a parent
  const getChildGroups = (parentPath: string) => {
    return groups.filter((g) => {
      const parts = g.path.split("/");
      parts.pop();
      return parts.join("/") === parentPath;
    });
  };

  // Render a group and its contents recursively
  const renderGroup = (group: Group, level: number = 0) => {
    const groupSessions = sessionsByGroup[group.path] || [];
    const childGroups = getChildGroups(group.path);
    const indent = level * 12;

    const groupHeader = (
      <div
        className="flex items-center gap-1 py-1.5 px-2 rounded hover:bg-accent/50 cursor-pointer group"
        style={{ marginLeft: indent }}
        onClick={() => onToggleGroup(group.path, !group.expanded)}
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 h-6 w-6">
              <MoreHorizontal className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setShowNewGroupInput(group.path);
              }}
            >
              <FolderPlus className="w-3 h-3 mr-2" />
              Add subgroup
            </DropdownMenuItem>
            {group.path !== "sessions" && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup(group.path);
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
        <ContextMenu>
          <ContextMenuTrigger asChild>{groupHeader}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setShowNewGroupInput(group.path)}>
              <FolderPlus className="w-3 h-3 mr-2" />
              Add subgroup
            </ContextMenuItem>
            {group.path !== "sessions" && (
              <ContextMenuItem onClick={() => onDeleteGroup(group.path)} className="text-red-500 focus:text-red-500">
                <Trash2 className="w-3 h-3 mr-2" />
                Delete group
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {showNewGroupInput === group.path && (
          <div className="flex gap-1 px-2" style={{ marginLeft: indent }}>
            <input
              type="text"
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newGroupName.trim()) {
                  onCreateGroup(newGroupName.trim(), group.path);
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

        {group.expanded && (
          <div className="border-l border-border/50 ml-3" style={{ marginLeft: indent + 12, paddingLeft: 8 }}>
            {childGroups.map((child) => renderGroup(child, level + 1))}

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
                        isSummarizing={summarizingSessionId === session.id}
                        tmuxStatus={sessionStatuses?.[session.id]?.status}
                        groups={groups}
                        onClick={() => onSelectSession(session.id)}
                        onFork={() => onForkSession(session.id)}
                        onSummarize={() => onSummarize(session.id)}
                        onDelete={() => onDeleteSession(session.id)}
                        onRename={(newName) => onRenameSession(session.id, newName)}
                        onHoverStart={(rect) => hoverHandlers.onHoverStart(session, rect)}
                        onHoverEnd={hoverHandlers.onHoverEnd}
                      />
                    </div>
                    {hasWorkers && (
                      <span className="flex-shrink-0 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                        {workers.length}
                      </span>
                    )}
                  </div>

                  {hasWorkers && (
                    <div className="ml-4 pl-2 border-l border-border/30 space-y-0.5">
                      {workers.map((worker) => (
                        <SessionCard
                          key={worker.id}
                          session={worker}
                          isActive={worker.id === activeSessionId}
                          tmuxStatus={sessionStatuses?.[worker.id]?.status}
                          groups={groups}
                          onClick={() => onSelectSession(worker.id)}
                          onDelete={() => onDeleteSession(worker.id)}
                          onRename={(newName) => onRenameSession(worker.id, newName)}
                          onHoverStart={(rect) => hoverHandlers.onHoverStart(worker, rect)}
                          onHoverEnd={hoverHandlers.onHoverEnd}
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

  return <>{rootGroups.map((group) => renderGroup(group))}</>;
}
