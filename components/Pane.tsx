"use client";

import { useRef, useCallback, useEffect, memo, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
  Unplug,
  Plus,
  Terminal as TerminalIcon,
  Users,
  FolderOpen,
  GitBranch,
} from "lucide-react";
import { usePanes } from "@/contexts/PaneContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TerminalHandle, TerminalScrollState } from "@/components/Terminal";
import type { Session } from "@/lib/db";
import { sessionRegistry } from "@/lib/client/session-registry";
import { ConductorPanel } from "./ConductorPanel";

// Dynamic imports for client-only components
const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false }
);

const FileExplorer = dynamic(
  () => import("@/components/FileExplorer").then((mod) => mod.FileExplorer),
  { ssr: false }
);

const GitPanel = dynamic(
  () => import("@/components/GitPanel").then((mod) => mod.GitPanel),
  { ssr: false }
);

interface PaneProps {
  paneId: string;
  sessions: Session[];
  onRegisterTerminal: (paneId: string, tabId: string, ref: TerminalHandle | null) => void;
}

type ViewMode = "terminal" | "files" | "git" | "workers";

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

  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const terminalRef = useRef<TerminalHandle>(null);
  const paneData = getPaneData(paneId);
  const activeTab = getActiveTab(paneId);
  const isFocused = focusedPaneId === paneId;
  const session = activeTab ? sessions.find((s) => s.id === activeTab.sessionId) : null;

  // Check if this session is a conductor (has workers)
  const workerCount = useMemo(() => {
    if (!session) return 0;
    return sessions.filter(s => s.conductor_session_id === session.id).length;
  }, [session, sessions]);

  const isConductor = workerCount > 0;

  // Get saved scroll state for current tab
  const initialScrollState = useMemo(() => {
    if (!activeTab?.id) return undefined;
    const saved = sessionRegistry.getTerminalState(paneId, activeTab.id);
    if (saved) {
      return {
        scrollTop: saved.scrollTop,
        cursorY: saved.cursorY,
        baseY: 0, // baseY not stored in registry
      } as TerminalScrollState;
    }
    return undefined;
  }, [paneId, activeTab?.id]);

  // Save scroll state when terminal unmounts
  const handleBeforeUnmount = useCallback((scrollState: TerminalScrollState) => {
    if (activeTab?.id) {
      sessionRegistry.saveTerminalState(paneId, activeTab.id, {
        scrollTop: scrollState.scrollTop,
        scrollHeight: 0,
        lastActivity: Date.now(),
        cursorY: scrollState.cursorY,
      });
    }
  }, [paneId, activeTab?.id]);

  // Reset view mode when session changes
  useEffect(() => {
    setViewMode("terminal");
  }, [session?.id]);

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

        {/* View Toggle - show for sessions with working directory */}
        {session?.working_directory && (
          <div className="flex items-center bg-zinc-800/50 rounded-md p-0.5 mx-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMode("terminal");
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                    viewMode === "terminal"
                      ? "bg-zinc-700 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <TerminalIcon className="w-3 h-3" />
                  <span className="hidden sm:inline">Term</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Terminal</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMode("files");
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                    viewMode === "files"
                      ? "bg-zinc-700 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <FolderOpen className="w-3 h-3" />
                  <span className="hidden sm:inline">Files</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>File explorer</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMode("git");
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                    viewMode === "git"
                      ? "bg-zinc-700 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <GitBranch className="w-3 h-3" />
                  <span className="hidden sm:inline">Git</span>
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
                      setViewMode("workers");
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                      viewMode === "workers"
                        ? "bg-zinc-700 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Users className="w-3 h-3" />
                    <span className="hidden sm:inline">Workers</span>
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

      {/* Content Area */}
      <div className="flex-1 min-h-0">
        {viewMode === "terminal" && (
          <Terminal
            key={activeTab?.id}
            ref={terminalRef}
            onConnected={handleTerminalConnected}
            onDisconnected={() => {}}
            onBeforeUnmount={handleBeforeUnmount}
            initialScrollState={initialScrollState}
          />
        )}
        {viewMode === "files" && session?.working_directory && (
          <FileExplorer
            workingDirectory={session.working_directory}
          />
        )}
        {viewMode === "git" && session?.working_directory && (
          <GitPanel
            workingDirectory={session.working_directory}
          />
        )}
        {viewMode === "workers" && session && (
          <ConductorPanel
            conductorSessionId={session.id}
            onAttachToWorker={(workerId) => {
              // Switch to terminal and attach to worker
              setViewMode("terminal");
              const worker = sessions.find(s => s.id === workerId);
              if (worker && terminalRef.current) {
                const sessionName = `claude-${workerId}`;
                terminalRef.current.sendInput("\x02d");
                setTimeout(() => {
                  terminalRef.current?.sendInput("\x15");
                  setTimeout(() => {
                    terminalRef.current?.sendCommand(`tmux attach -t ${sessionName}`);
                  }, 50);
                }, 100);
              }
            }}
          />
        )}
      </div>
    </div>
  );
});
