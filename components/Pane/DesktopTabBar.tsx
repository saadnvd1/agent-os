"use client";

import { ViewSwitch } from "@/components/Chat/ViewSwitch";
import { ContextMeter } from "@/components/Chat/ContextMeter";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import { PaneViewToggle } from "./PaneViewToggle";
import { PaneMenu } from "./PaneMenu";
import { usePaneBarSlots } from "./PaneBarSlots";

type ViewMode = "terminal" | "files" | "git" | "workers";

interface Tab {
  id: string;
  sessionId: string | null;
  attachedTmux: string | null;
  draftId?: string | null;
}

interface DesktopTabBarProps {
  paneId: string;
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
  paneId,
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
  const { leading, trailing } = usePaneBarSlots(paneId);

  const tabSession = (tab: Tab) =>
    tab.sessionId ? sessions.find((s) => s.id === tab.sessionId) : undefined;
  const getTabName = (tab: Tab) => {
    if (tab.sessionId)
      return tabSession(tab)?.name || tab.attachedTmux || "Session";
    if (tab.draftId) return "New session";
    return tab.attachedTmux || "New Tab";
  };

  const isLocalSession = !session?.host_id || session.host_id === "local";

  return (
    <div
      className={cn(
        "scrollbar-none @container/bar flex items-center gap-1 overflow-x-auto px-1.5 py-1.5 transition-colors",
        "shadow-[inset_0_-1px_0_hsl(var(--foreground)/0.06)]",
        isFocused ? "bg-foreground/[0.025]" : "bg-transparent"
      )}
    >
      {leading}

      {/* Tabs */}
      <div className="scrollbar-none flex min-w-28 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            title={tabSession(tab)?.tmux_name ?? undefined}
            onClick={(e) => {
              e.stopPropagation();
              onTabSwitch(tab.id);
            }}
            className={cn(
              "group relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab.id === activeTabId
                ? "bg-foreground/[0.07] text-foreground after:bg-primary after:absolute after:inset-x-3 after:-bottom-1.5 after:h-px"
                : "text-muted-foreground hover:text-foreground/80 hover:bg-foreground/[0.04]"
            )}
          >
            <span className="max-w-[160px] truncate">{getTabName(tab)}</span>
            {tabs.length > 1 && (
              <button
                aria-label="Close tab"
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
              aria-label="New tab"
              onClick={(e) => {
                e.stopPropagation();
                onTabAdd();
              }}
              className="mx-1 h-6 w-6 shrink-0"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New tab</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <ContextMeter sessionId={session?.id} />
        <ViewSwitch session={session} />
        {session?.working_directory && (
          <PaneViewToggle
            viewMode={viewMode}
            isLocalSession={isLocalSession}
            isConductor={isConductor}
            workerCount={workerCount}
            gitDrawerOpen={gitDrawerOpen}
            shellDrawerOpen={shellDrawerOpen}
            onViewModeChange={onViewModeChange}
            onGitDrawerToggle={onGitDrawerToggle}
            onShellDrawerToggle={onShellDrawerToggle}
          />
        )}
        <div className="flex items-center">
          <PaneMenu
            session={session}
            canSplit={canSplit}
            canClose={canClose}
            hasAttachedTmux={hasAttachedTmux}
            onSplitHorizontal={onSplitHorizontal}
            onSplitVertical={onSplitVertical}
            onClose={onClose}
            onDetach={onDetach}
          />
          {canClose && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  className="h-7 w-7"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close pane</TooltipContent>
            </Tooltip>
          )}
        </div>
        {trailing && (
          <>
            <div className="bg-foreground/10 mx-0.5 h-4 w-px" />
            {trailing}
          </>
        )}
      </div>
    </div>
  );
}
