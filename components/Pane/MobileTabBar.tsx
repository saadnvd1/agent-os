"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  Terminal as TerminalIcon,
  FolderOpen,
  GitBranch,
  Users,
  ChevronDown,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session, Project } from "@/lib/db";
import type { LucideIcon } from "lucide-react";

type ViewMode = "terminal" | "files" | "git" | "workers";

interface ViewModeButtonProps {
  mode: ViewMode;
  currentMode: ViewMode;
  icon: LucideIcon;
  onClick: (mode: ViewMode) => void;
  badge?: React.ReactNode;
}

function ViewModeButton({ mode, currentMode, icon: Icon, onClick, badge }: ViewModeButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(mode);
      }}
      className={cn(
        "p-1.5 rounded transition-colors",
        badge && "flex items-center gap-0.5",
        currentMode === mode
          ? "bg-secondary text-foreground"
          : "text-muted-foreground"
      )}
    >
      <Icon className="w-4 h-4" />
      {badge}
    </button>
  );
}

interface MobileTabBarProps {
  session: Session | null | undefined;
  sessions: Session[];
  projects: Project[];
  viewMode: ViewMode;
  isConductor: boolean;
  workerCount: number;
  onMenuClick?: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSelectSession: (sessionId: string) => void;
}

export function MobileTabBar({
  session,
  sessions,
  projects,
  viewMode,
  isConductor,
  workerCount,
  onMenuClick,
  onViewModeChange,
  onSelectSession,
}: MobileTabBarProps) {
  // Find current session index and calculate prev/next
  const currentIndex = session ? sessions.findIndex(s => s.id === session.id) : -1;

  // Get project name for current session
  const projectName = session?.project_id
    ? projects.find(p => p.id === session.project_id)?.name
    : null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < sessions.length - 1;

  // Debounce to prevent rapid clicking causing command interference
  const [isNavigating, setIsNavigating] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleNavigate = useCallback((sessionId: string) => {
    if (isNavigating) return;

    setIsNavigating(true);
    onSelectSession(sessionId);

    // Allow next navigation after delay (tmux commands need time)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setIsNavigating(false);
    }, 500);
  }, [isNavigating, onSelectSession]);

  const handlePrev = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasPrev && !isNavigating) {
      handleNavigate(sessions[currentIndex - 1].id);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasNext && !isNavigating) {
      handleNavigate(sessions[currentIndex + 1].id);
    }
  };

  return (
    <div
      className="flex items-center px-2 py-1.5 gap-2 bg-muted"
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/* Menu button */}
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          className="h-8 w-8 shrink-0"
        >
          <Menu className="w-4 h-4" />
        </Button>
      )}

      {/* Session/Tab navigation */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <button
          type="button"
          onClick={handlePrev}
          onTouchEnd={(e) => e.stopPropagation()}
          disabled={!hasPrev || isNavigating}
          className="h-8 w-8 shrink-0 rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Session selector dropdown */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-1 rounded-md hover:bg-accent active:bg-accent"
            >
              <span className="text-sm font-medium truncate">
                {session?.name || "No session"}
                {projectName && projectName !== "Uncategorized" && (
                  <span className="text-muted-foreground font-normal"> [{projectName}]</span>
                )}
              </span>
              <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="max-h-[300px] overflow-y-auto min-w-[200px]">
            {sessions.filter(s => !s.conductor_session_id).map((s) => {
              const sessionProject = s.project_id
                ? projects.find(p => p.id === s.project_id)
                : null;
              const isActive = s.id === session?.id;

              return (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => onSelectSession(s.id)}
                  className={cn(
                    "flex items-center gap-2",
                    isActive && "bg-accent"
                  )}
                >
                  <Circle className={cn(
                    "w-2 h-2",
                    isActive ? "fill-primary text-primary" : "text-muted-foreground"
                  )} />
                  <span className="truncate flex-1">
                    {s.name}
                  </span>
                  {sessionProject && sessionProject.name !== "Uncategorized" && (
                    <span className="text-xs text-muted-foreground">
                      [{sessionProject.name}]
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={handleNext}
          onTouchEnd={(e) => e.stopPropagation()}
          disabled={!hasNext || isNavigating}
          className="h-8 w-8 shrink-0 rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* View mode toggle */}
      {session?.working_directory && (
        <div className="flex items-center bg-accent/50 rounded-md p-0.5 shrink-0">
          <ViewModeButton mode="terminal" currentMode={viewMode} icon={TerminalIcon} onClick={onViewModeChange} />
          <ViewModeButton mode="files" currentMode={viewMode} icon={FolderOpen} onClick={onViewModeChange} />
          <ViewModeButton mode="git" currentMode={viewMode} icon={GitBranch} onClick={onViewModeChange} />
          {isConductor && (
            <ViewModeButton
              mode="workers"
              currentMode={viewMode}
              icon={Users}
              onClick={onViewModeChange}
              badge={<span className="text-[10px] bg-primary/20 text-primary px-1 rounded">{workerCount}</span>}
            />
          )}
        </div>
      )}
    </div>
  );
}
