"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Settings,
  Plus,
  Server,
  Trash2,
  Pencil,
  FolderOpen,
  Play,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Project, DevServer } from "@/lib/db";

interface ProjectCardProps {
  project: Project;
  sessionCount: number;
  runningDevServers?: DevServer[];
  onClick?: () => void;
  onToggleExpanded?: (expanded: boolean) => void;
  onEdit?: () => void;
  onNewSession?: () => void;
  onStartDevServers?: () => void;
  onStopDevServers?: () => void;
  onOpenInEditor?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
}

export function ProjectCard({
  project,
  sessionCount,
  runningDevServers = [],
  onClick,
  onToggleExpanded,
  onEdit,
  onNewSession,
  onStartDevServers,
  onStopDevServers,
  onOpenInEditor,
  onDelete,
  onRename,
}: ProjectCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasRunningServers = runningDevServers.length > 0;
  const hasActions = !project.is_uncategorized && (onEdit || onNewSession || onDelete || onRename);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    if (editName.trim() && editName !== project.name && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isEditing) return;
    onClick?.();
    onToggleExpanded?.(!project.expanded);
  };

  const renderMenuItems = (isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu ? ContextMenuSeparator : DropdownMenuSeparator;

    return (
      <>
        {onNewSession && (
          <MenuItem onClick={() => onNewSession()}>
            <Plus className="w-3 h-3 mr-2" />
            New session
          </MenuItem>
        )}
        {onEdit && (
          <MenuItem onClick={() => onEdit()}>
            <Settings className="w-3 h-3 mr-2" />
            Project settings
          </MenuItem>
        )}
        {onRename && (
          <MenuItem onClick={() => setIsEditing(true)}>
            <Pencil className="w-3 h-3 mr-2" />
            Rename
          </MenuItem>
        )}
        {onOpenInEditor && (
          <MenuItem onClick={() => onOpenInEditor()}>
            <FolderOpen className="w-3 h-3 mr-2" />
            Open in editor
          </MenuItem>
        )}
        {(onStartDevServers || onStopDevServers) && (
          <>
            <MenuSeparator />
            {hasRunningServers && onStopDevServers && (
              <MenuItem onClick={() => onStopDevServers()}>
                <Square className="w-3 h-3 mr-2" />
                Stop all servers
              </MenuItem>
            )}
            {!hasRunningServers && onStartDevServers && (
              <MenuItem onClick={() => onStartDevServers()}>
                <Play className="w-3 h-3 mr-2" />
                Start dev servers
              </MenuItem>
            )}
          </>
        )}
        {onDelete && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onDelete()} className="text-red-500 focus:text-red-500">
              <Trash2 className="w-3 h-3 mr-2" />
              Delete project
            </MenuItem>
          </>
        )}
      </>
    );
  };

  const cardContent = (
    <div
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1 py-2 px-2 rounded-md cursor-pointer group",
        "min-h-[44px] md:min-h-[32px]",
        "hover:bg-accent/50"
      )}
    >
      {/* Expand/collapse toggle */}
      <button className="p-0.5 flex-shrink-0">
        {project.expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Project name */}
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
              setEditName(project.name);
              setIsEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-sm font-medium bg-transparent border-b border-primary outline-none min-w-0"
        />
      ) : (
        <span className="flex-1 text-sm font-medium truncate min-w-0">
          {project.name}
        </span>
      )}

      {/* Running servers indicator */}
      {hasRunningServers && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 text-green-500 flex-shrink-0">
              <Server className="w-3 h-3" />
              <span className="text-xs">{runningDevServers.length}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{runningDevServers.length} dev server{runningDevServers.length > 1 ? "s" : ""} running</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Session count */}
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {sessionCount}
      </span>

      {/* Actions menu */}
      {hasActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 h-7 w-7 md:h-6 md:w-6 flex-shrink-0"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {renderMenuItems(false)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  // Wrap with context menu if actions are available
  if (hasActions) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {cardContent}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {renderMenuItems(true)}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return cardContent;
}
