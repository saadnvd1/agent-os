"use client";

import { Button } from "@/components/ui/button";
import {
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
  Unplug,
  Plus,
  FolderOpen,
  GitBranch,
  Users,
  Home,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";

type ViewMode = "terminal" | "files" | "git" | "workers";

interface Tab {
  id: string;
  sessionId: string | null;
  attachedTmux: string | null;
}

interface DesktopTabBarProps {
  tabs: Tab[];
  activeTabId: string;
  session: Session | null | undefined;
  sessions: Session[];
  viewMode: ViewMode;
  isFocused: boolean;
  isConductor: boolean;
  workerCount: number;
  canSplit: boolean;
  canClose: boolean;
  hasAttachedTmux: boolean;
  gitDrawerOpen: boolean;
  shellDrawerOpen: boolean;
  onTabSwitch: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onGitDrawerToggle: () => void;
  onShellDrawerToggle: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClose: () => void;
  onDetach: () => void;
}

export function DesktopTabBar({
  tabs,
  activeTabId,
  session,
  sessions,
  viewMode,
  isFocused,
  isConductor,
  workerCount,
  canSplit,
  canClose,
  hasAttachedTmux,
  gitDrawerOpen,
  shellDrawerOpen,
  onTabSwitch,
  onTabClose,
  onTabAdd,
  onViewModeChange,
  onGitDrawerToggle,
  onShellDrawerToggle,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
  onDetach,
}: DesktopTabBarProps) {
  const getTabName = (tab: Tab) => {
    if (tab.sessionId) {
      const s = sessions.find((sess) => sess.id === tab.sessionId);
      return s?.name || tab.attachedTmux || "Session";
    }
    if (tab.attachedTmux) return tab.attachedTmux;
    return "New Tab";
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 overflow-x-auto px-1 pt-1 transition-colors",
        isFocused ? "bg-muted" : "bg-muted/50"
      )}
    >
      {/* Tabs */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={(e) => {
              e.stopPropagation();
              onTabSwitch(tab.id);
            }}
            className={cn(
              "group flex cursor-pointer items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs transition-colors",
              tab.id === activeTabId
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/50"
            )}
          >
            <span className="max-w-[120px] truncate">{getTabName(tab)}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="hover:text-foreground ml-1 opacity-0 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onTabAdd();
              }}
              className="mx-1 h-6 w-6"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New tab</TooltipContent>
        </Tooltip>
      </div>

      {/* View Toggle */}
      {session?.working_directory && (
        <div className="bg-accent/50 mx-2 flex items-center rounded-md p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewModeChange("terminal");
                }}
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  viewMode === "terminal"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Home className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Terminal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewModeChange("files");
                }}
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  viewMode === "files"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onGitDrawerToggle();
                }}
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  gitDrawerOpen
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Git</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onShellDrawerToggle();
                }}
                className={cn(
                  "rounded px-2 py-1 font-mono text-xs transition-colors",
                  shellDrawerOpen
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {">_"}
              </button>
            </TooltipTrigger>
            <TooltipContent>Shell</TooltipContent>
          </Tooltip>
          {isConductor && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewModeChange("workers");
                  }}
                  className={cn(
                    "relative rounded px-2 py-1 transition-colors",
                    viewMode === "workers"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full text-[9px] font-medium">
                    {workerCount}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Workers</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Pane Controls */}
      <div className="ml-auto flex items-center gap-0.5 px-2">
        {hasAttachedTmux && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDetach();
                }}
                className="h-6 w-6"
              >
                <Unplug className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Detach from tmux</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onSplitHorizontal();
              }}
              disabled={!canSplit}
              className="h-6 w-6"
            >
              <SplitSquareHorizontal className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Split horizontal</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onSplitVertical();
              }}
              disabled={!canSplit}
              className="h-6 w-6"
            >
              <SplitSquareVertical className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Split vertical</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              disabled={!canClose}
              className="h-6 w-6"
            >
              <X className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close pane</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
