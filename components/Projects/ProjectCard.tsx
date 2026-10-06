"use client";

import type { ProjectRowModel } from "@/lib/project-rows";
import { ProjectAvatar } from "./ProjectAvatar";
import { HostBadge } from "@/components/Hosts/HostBadge";
import { BoardChip, ProjectBoardItem } from "@/components/LumifyHub";
import {
  useWorkspacesQuery,
  useMoveProjectToWorkspace,
} from "@/data/workspaces";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  Settings,
  Plus,
  Server,
  Trash2,
  Pencil,
  FolderOpen,
  Terminal,
  LayoutGrid,
  ChevronRight,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Project, DevServer } from "@/lib/db";

interface ProjectCardProps {
  project: Project;
  sessionCount: number;
  runningDevServers?: DevServer[];
  onClick?: () => void;
  onToggleExpanded?: (expanded: boolean) => void;
  onEdit?: () => void;
  onNewSession?: () => void;
  onOpenTerminal?: () => void;
  onStartDevServer?: () => void;
  onOpenInEditor?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  // What runs in the project. A click opens its latest session, or starts
  // one when it has none; the count expands the full list.
  row?: ProjectRowModel;
  onOpenLatest?: () => void;
  onStartSession?: () => void;
}

export function ProjectCard({
  project,
  sessionCount,
  runningDevServers = [],
  onClick,
  onToggleExpanded,
  onEdit,
  onNewSession,
  onOpenTerminal,
  onStartDevServer,
  onOpenInEditor,
  onDelete,
  onRename,
  row,
  onOpenLatest,
  onStartSession,
}: ProjectCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const justStartedEditingRef = useRef(false);

  const hasRunningServers = runningDevServers.length > 0;
  // Uncategorized can have New Session, Open Terminal, and Rename, but not Edit/Delete/DevServer
  const hasActions = project.is_uncategorized
    ? onNewSession || onOpenTerminal || onRename
    : onEdit ||
      onNewSession ||
      onOpenTerminal ||
      onStartDevServer ||
      onDelete ||
      onRename;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      const input = inputRef.current;
      // Mark that we just started editing to ignore immediate blur
      justStartedEditingRef.current = true;
      // Small timeout to ensure input is fully mounted
      setTimeout(() => {
        input.focus();
        input.select();
        // Clear the flag after focus is established
        setTimeout(() => {
          justStartedEditingRef.current = false;
        }, 100);
      }, 0);
    }
  }, [isEditing]);

  const handleRename = () => {
    // Ignore blur events that happen immediately after starting to edit
    if (justStartedEditingRef.current) return;

    if (editName.trim() && editName !== project.name && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleClick = () => {
    if (isEditing) return;
    onClick?.();
    if (row?.latest && onOpenLatest) onOpenLatest();
    else if (!row?.latest && onStartSession) onStartSession();
    else onToggleExpanded?.(!project.expanded);
  };

  const { data: workspaces = [] } = useWorkspacesQuery();
  const moveProject = useMoveProjectToWorkspace();

  const renderMenuItems = (isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu
      ? ContextMenuSeparator
      : DropdownMenuSeparator;

    return (
      <>
        {onNewSession && (
          <MenuItem onClick={() => onNewSession()}>
            <Plus className="mr-2 h-3 w-3" />
            New session
          </MenuItem>
        )}
        {onOpenTerminal && (
          <MenuItem onClick={() => onOpenTerminal()}>
            <Terminal className="mr-2 h-3 w-3" />
            Open terminal
          </MenuItem>
        )}
        {onEdit && (
          <MenuItem onClick={() => onEdit()}>
            <Settings className="mr-2 h-3 w-3" />
            Project settings
          </MenuItem>
        )}
        {onRename && (
          <MenuItem onClick={() => setIsEditing(true)}>
            <Pencil className="mr-2 h-3 w-3" />
            Rename
          </MenuItem>
        )}
        {onOpenInEditor && (
          <MenuItem onClick={() => onOpenInEditor()}>
            <FolderOpen className="mr-2 h-3 w-3" />
            Open in editor
          </MenuItem>
        )}
        {!project.is_uncategorized &&
          workspaces.some((w) => w.id !== project.workspace_id) && (
            <MenuSeparator />
          )}
        {!project.is_uncategorized &&
          workspaces
            .filter((w) => w.id !== project.workspace_id)
            .map((w) => (
              <MenuItem
                key={w.id}
                onClick={() =>
                  moveProject.mutate({
                    projectId: project.id,
                    workspaceId: w.id,
                  })
                }
              >
                <LayoutGrid className="mr-2 h-3 w-3" />
                Move to {w.name}
              </MenuItem>
            ))}
        {project.workspace_id && (
          <MenuItem
            onClick={() =>
              moveProject.mutate({ projectId: project.id, workspaceId: null })
            }
          >
            <LayoutGrid className="mr-2 h-3 w-3" />
            Remove from workspace
          </MenuItem>
        )}
        {!project.is_uncategorized && (
          <ProjectBoardItem project={project} Item={MenuItem} />
        )}
        {onStartDevServer && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onStartDevServer()}>
              <Server className="mr-2 h-3 w-3" />
              Start dev server
            </MenuItem>
          </>
        )}
        {onDelete && (
          <>
            <MenuSeparator />
            <MenuItem
              onClick={() => onDelete()}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="mr-2 h-3 w-3" />
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
        "group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2",
        "hover:bg-foreground/[0.04] min-h-11 md:min-h-9",
        row?.active &&
          "bg-foreground/[0.06] shadow-[inset_2px_0_0_hsl(var(--primary))]"
      )}
    >
      <ProjectAvatar
        name={project.name}
        state={row?.state}
        dim={!row?.running}
      />
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
          className="border-primary min-w-0 flex-1 border-b bg-transparent text-sm font-medium outline-none"
        />
      ) : (
        <span className="flex min-w-0 flex-1 flex-col py-1 leading-tight">
          <span
            className={cn(
              "truncate text-sm",
              row?.running
                ? "text-foreground font-medium"
                : "text-muted-foreground"
            )}
          >
            {project.name}
          </span>
          {row?.subtitle && (
            <span
              className={cn(
                "truncate text-[11px]",
                row.state === "blocked"
                  ? "text-destructive"
                  : "text-muted-foreground/70"
              )}
            >
              {row.subtitle}
            </span>
          )}
        </span>
      )}
      <BoardChip project={project} />
      <HostBadge hostId={project.host_id} />

      {/* Running servers indicator */}
      {hasRunningServers && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-shrink-0 items-center gap-1 text-green-500">
              <Server className="h-3 w-3" />
              <span className="text-xs">{runningDevServers.length}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {runningDevServers.length} dev server
              {runningDevServers.length > 1 ? "s" : ""} running
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Session count: expands the full list */}
      {!row?.single && sessionCount > 1 && (
        <button
          type="button"
          aria-label={
            project.expanded ? "Hide sessions" : `Show ${sessionCount} sessions`
          }
          aria-expanded={project.expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded?.(!project.expanded);
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] -my-1 flex h-8 min-w-8 flex-shrink-0 items-center justify-center gap-0.5 rounded-md px-1 font-mono text-[10px] tabular-nums md:h-6 md:min-w-6"
        >
          {sessionCount}
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              project.expanded && "rotate-90"
            )}
          />
        </button>
      )}

      {/* Actions menu */}
      {hasActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "bg-sidebar-background hover:bg-accent h-7 w-7 md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100",
                // Floats over the row's edge, except beside the session
                // count, which it would otherwise cover on hover.
                (row?.single || sessionCount <= 1) &&
                  "md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2"
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
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
        <ContextMenuTrigger asChild>{cardContent}</ContextMenuTrigger>
        <ContextMenuContent>{renderMenuItems(true)}</ContextMenuContent>
      </ContextMenu>
    );
  }

  return cardContent;
}
