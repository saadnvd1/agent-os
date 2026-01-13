"use client";

import { Button } from "@/components/ui/button";
import {
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
  Unplug,
  Plus,
  Terminal as TerminalIcon,
  FolderOpen,
  GitBranch,
  Users,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  onTabSwitch: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
  onViewModeChange: (mode: ViewMode) => void;
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
  onTabSwitch,
  onTabClose,
  onTabAdd,
  onViewModeChange,
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
    <div className={cn(
      "flex items-center overflow-x-auto px-1 pt-1 gap-1 transition-colors",
      isFocused ? "bg-muted" : "bg-muted/50"
    )}>
      {/* Tabs */}
      <div className="flex items-center flex-1 min-w-0 gap-0.5">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={(e) => {
              e.stopPropagation();
              onTabSwitch(tab.id);
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer group rounded-t-md transition-colors",
              tab.id === activeTabId
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/50"
            )}
          >
            <span className="truncate max-w-[120px]">{getTabName(tab)}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-foreground ml-1"
              >
                <X className="w-3 h-3" />
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
              className="h-6 w-6 mx-1"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New tab</TooltipContent>
        </Tooltip>
      </div>

      {/* View Toggle */}
      {session?.working_directory && (
        <div className="flex items-center bg-accent/50 rounded-md p-0.5 mx-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewModeChange("terminal");
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                  viewMode === "terminal"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <TerminalIcon className="w-3 h-3" />
                <span>Term</span>
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
                  "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                  viewMode === "files"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FolderOpen className="w-3 h-3" />
                <span>Files</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>File explorer</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewModeChange("git");
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                  viewMode === "git"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <GitBranch className="w-3 h-3" />
                <span>Git</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Git status</TooltipContent>
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
                    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                    viewMode === "workers"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Users className="w-3 h-3" />
                  <span>Workers</span>
                  <span className="text-[10px] bg-primary/20 text-primary px-1 rounded">
                    {workerCount}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>View workers</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Pane Controls */}
      <div className="flex items-center gap-0.5 px-2 ml-auto">
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
                <Unplug className="w-3 h-3" />
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
              <SplitSquareHorizontal className="w-3 h-3" />
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
              <SplitSquareVertical className="w-3 h-3" />
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
              <X className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close pane</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
