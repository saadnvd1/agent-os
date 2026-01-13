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
import type { TabData } from "@/lib/panes";

type ViewMode = "terminal" | "files" | "git" | "workers";

interface MobileTabBarProps {
  session: Session | null | undefined;
  sessions: Session[];
  projects: Project[];
  tabs: TabData[];
  activeTabId: string;
  viewMode: ViewMode;
  isConductor: boolean;
  workerCount: number;
  onMenuClick?: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSelectSession: (sessionId: string) => void;
  onTabSwitch: (tabId: string) => void;
}

export function MobileTabBar({
  session,
  sessions,
  projects,
  tabs,
  activeTabId,
  viewMode,
  isConductor,
  workerCount,
  onMenuClick,
  onViewModeChange,
  onSelectSession,
  onTabSwitch,
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

        {/* Tab selector dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-1 rounded-md hover:bg-accent"
            >
              <span className="text-sm font-medium truncate">
                {session?.name || "No session"}
                {projectName && projectName !== "Uncategorized" && (
                  <span className="text-muted-foreground font-normal"> [{projectName}]</span>
                )}
              </span>
              {tabs.length > 1 && (
                <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
              )}
            </button>
          </DropdownMenuTrigger>
          {tabs.length > 1 && (
            <DropdownMenuContent align="center" className="max-h-[300px] overflow-y-auto">
              {tabs.map((tab, index) => {
                const tabSession = tab.sessionId
                  ? sessions.find(s => s.id === tab.sessionId)
                  : null;
                const tabProject = tabSession?.project_id
                  ? projects.find(p => p.id === tabSession.project_id)
                  : null;
                const isActive = tab.id === activeTabId;

                return (
                  <DropdownMenuItem
                    key={tab.id}
                    onClick={() => onTabSwitch(tab.id)}
                    className={cn(
                      "flex items-center gap-2",
                      isActive && "bg-accent"
                    )}
                  >
                    <Circle className={cn(
                      "w-2 h-2",
                      isActive ? "fill-primary text-primary" : "text-muted-foreground"
                    )} />
                    <span className="truncate">
                      {tabSession?.name || `Tab ${index + 1}`}
                    </span>
                    {tabProject && tabProject.name !== "Uncategorized" && (
                      <span className="text-xs text-muted-foreground">
                        [{tabProject.name}]
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          )}
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewModeChange("terminal");
            }}
            className={cn(
              "p-1.5 rounded transition-colors",
              viewMode === "terminal"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground"
            )}
          >
            <TerminalIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewModeChange("files");
            }}
            className={cn(
              "p-1.5 rounded transition-colors",
              viewMode === "files"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground"
            )}
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewModeChange("git");
            }}
            className={cn(
              "p-1.5 rounded transition-colors",
              viewMode === "git"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground"
            )}
          >
            <GitBranch className="w-4 h-4" />
          </button>
          {isConductor && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewModeChange("workers");
              }}
              className={cn(
                "p-1.5 rounded transition-colors flex items-center gap-0.5",
                viewMode === "workers"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Users className="w-4 h-4" />
              <span className="text-[10px] bg-primary/20 text-primary px-1 rounded">
                {workerCount}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
