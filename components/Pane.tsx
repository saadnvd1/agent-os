"use client";

import { useRef, useCallback, useEffect, memo } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
  Unplug,
  Plus,
} from "lucide-react";
import { usePanes } from "@/contexts/PaneContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TerminalHandle } from "@/components/Terminal";
import type { Session } from "@/lib/db";

// Dynamic import for Terminal (client-only)
const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false }
);

interface PaneProps {
  paneId: string;
  sessions: Session[];
  onRegisterTerminal: (paneId: string, tabId: string, ref: TerminalHandle | null) => void;
}

export const Pane = memo(function Pane({ paneId, sessions, onRegisterTerminal }: PaneProps) {
  const {
    focusedPaneId,
    canSplit,
    canClose,
    focusPane,
    splitHorizontal,
    splitVertical,
    close,
    getPaneData,
    getActiveTab,
    addTab,
    closeTab,
    switchTab,
    detachSession,
  } = usePanes();

  const terminalRef = useRef<TerminalHandle>(null);
  const paneData = getPaneData(paneId);
  const activeTab = getActiveTab(paneId);
  const isFocused = focusedPaneId === paneId;
  const session = activeTab ? sessions.find((s) => s.id === activeTab.sessionId) : null;

  const handleFocus = useCallback(() => {
    focusPane(paneId);
  }, [focusPane, paneId]);

  const handleDetach = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.sendInput("\x02d"); // Ctrl+B d to detach
    }
    detachSession(paneId);
  }, [detachSession, paneId]);

  // Register terminal when connected and auto-reattach if needed
  const handleTerminalConnected = useCallback(() => {
    if (terminalRef.current && activeTab) {
      onRegisterTerminal(paneId, activeTab.id, terminalRef.current);

      // Auto-reattach to tmux session if one was attached
      if (activeTab.attachedTmux) {
        setTimeout(() => {
          terminalRef.current?.sendCommand(`tmux attach -t ${activeTab.attachedTmux}`);
        }, 100);
      }
    }
  }, [paneId, activeTab, onRegisterTerminal]);

  // Track current tab ID for cleanup
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTab?.id || null;

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (activeTabIdRef.current) {
        onRegisterTerminal(paneId, activeTabIdRef.current, null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, onRegisterTerminal]);

  // Get tab display name
  const getTabName = (tab: typeof activeTab) => {
    if (!tab) return "New Tab";
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
        "flex flex-col h-full rounded-lg overflow-hidden shadow-lg shadow-black/20",
        isFocused ? "ring-1 ring-primary/50" : ""
      )}
      onClick={handleFocus}
    >
      {/* Tab Bar */}
      <div className="flex items-center bg-zinc-900/80 overflow-x-auto px-1 pt-1 gap-1">
        <div className="flex items-center flex-1 min-w-0 gap-0.5">
          {paneData.tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={(e) => {
                e.stopPropagation();
                switchTab(paneId, tab.id);
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer group rounded-t-md transition-colors",
                tab.id === paneData.activeTabId
                  ? "bg-zinc-950 text-foreground"
                  : "text-muted-foreground hover:text-foreground/80 hover:bg-zinc-800/50"
              )}
            >
              <span className="truncate max-w-[120px]">{getTabName(tab)}</span>
              {paneData.tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(paneId, tab.id);
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
                  addTab(paneId);
                }}
                className="h-6 w-6 mx-1"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New tab</TooltipContent>
          </Tooltip>
        </div>

        {/* Pane Controls */}
        <div className="flex items-center gap-0.5 px-2 ml-auto">
          {activeTab?.attachedTmux && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDetach();
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
                  splitHorizontal(paneId);
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
                  splitVertical(paneId);
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
                  close(paneId);
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

      {/* Terminal */}
      <div className="flex-1 min-h-0 touch-none">
        <Terminal
          key={activeTab?.id}
          ref={terminalRef}
          onConnected={handleTerminalConnected}
          onDisconnected={() => {}}
        />
      </div>
    </div>
  );
});
