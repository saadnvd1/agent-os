"use client";

import { useRef, useCallback, useEffect, memo, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import type {
  TerminalHandle,
  TerminalScrollState,
} from "@/components/Terminal";
import type { Session, Project } from "@/lib/db";
import { sessionRegistry } from "@/lib/client/session-registry";
import { ConductorPanel } from "@/components/ConductorPanel";
import { useFileEditor } from "@/hooks/useFileEditor";
import { MobileTabBar } from "./MobileTabBar";
import { DesktopTabBar } from "./DesktopTabBar";
import {
  TerminalSkeleton,
  FileExplorerSkeleton,
  GitPanelSkeleton,
} from "./PaneSkeletons";
import { GitDrawer } from "@/components/GitDrawer";

// Dynamic imports for client-only components with loading states
const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

const FileExplorer = dynamic(
  () => import("@/components/FileExplorer").then((mod) => mod.FileExplorer),
  { ssr: false, loading: () => <FileExplorerSkeleton /> }
);

const GitPanel = dynamic(
  () => import("@/components/GitPanel").then((mod) => mod.GitPanel),
  { ssr: false, loading: () => <GitPanelSkeleton /> }
);

interface PaneProps {
  paneId: string;
  sessions: Session[];
  projects: Project[];
  onRegisterTerminal: (
    paneId: string,
    tabId: string,
    ref: TerminalHandle | null
  ) => void;
  onMenuClick?: () => void;
  onSelectSession?: (sessionId: string) => void;
}

type ViewMode = "terminal" | "files" | "git" | "workers";

export const Pane = memo(function Pane({
  paneId,
  sessions,
  projects,
  onRegisterTerminal,
  onMenuClick,
  onSelectSession,
}: PaneProps) {
  const { isMobile } = useViewport();
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
  const [gitDrawerOpen, setGitDrawerOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("gitDrawerOpen");
    return stored === null ? true : stored === "true";
  });
  const terminalRefs = useRef<Map<string, TerminalHandle | null>>(new Map());
  const paneData = getPaneData(paneId);
  const activeTab = getActiveTab(paneId);

  // Get ref for active terminal
  const terminalRef = activeTab
    ? (terminalRefs.current.get(activeTab.id) ?? null)
    : null;
  const isFocused = focusedPaneId === paneId;
  const session = activeTab
    ? sessions.find((s) => s.id === activeTab.sessionId)
    : null;

  // File editor state - lifted here so it persists across view switches
  const fileEditor = useFileEditor();

  // Check if this session is a conductor (has workers)
  const workerCount = useMemo(() => {
    if (!session) return 0;
    return sessions.filter((s) => s.conductor_session_id === session.id).length;
  }, [session, sessions]);

  const isConductor = workerCount > 0;

  // Reset view mode and file editor when session changes
  useEffect(() => {
    setViewMode("terminal");
    fileEditor.reset();
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist git drawer state
  useEffect(() => {
    localStorage.setItem("gitDrawerOpen", String(gitDrawerOpen));
  }, [gitDrawerOpen]);

  const handleFocus = useCallback(() => {
    focusPane(paneId);
  }, [focusPane, paneId]);

  const handleDetach = useCallback(() => {
    if (terminalRef) {
      terminalRef.sendInput("\x02d"); // Ctrl+B d to detach
    }
    detachSession(paneId);
  }, [detachSession, paneId, terminalRef]);

  // Create ref callback for a specific tab
  const getTerminalRef = useCallback(
    (tabId: string) => (handle: TerminalHandle | null) => {
      if (handle) {
        terminalRefs.current.set(tabId, handle);
      } else {
        terminalRefs.current.delete(tabId);
      }
    },
    []
  );

  // Create onConnected callback for a specific tab
  const getTerminalConnectedHandler = useCallback(
    (tab: (typeof paneData.tabs)[0]) => () => {
      console.log(
        `[AgentOS] Terminal connected for pane: ${paneId}, tab: ${tab.id}`
      );
      const handle = terminalRefs.current.get(tab.id);
      if (!handle) return;

      onRegisterTerminal(paneId, tab.id, handle);

      // Determine tmux session name to attach
      const tmuxName = tab.sessionId
        ? sessions.find((s) => s.id === tab.sessionId)?.tmux_name ||
          tab.attachedTmux
        : tab.attachedTmux;

      if (tmuxName) {
        setTimeout(() => handle.sendCommand(`tmux attach -t ${tmuxName}`), 100);
      }
    },
    [paneId, sessions, onRegisterTerminal]
  );

  // Track current tab ID for cleanup
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTab?.id || null;

  // Cleanup on unmount only
  useEffect(() => {
    console.log(
      `[AgentOS] Pane ${paneId} mounted, activeTab: ${activeTab?.id || "null"}`
    );
    return () => {
      console.log(
        `[AgentOS] Pane ${paneId} unmounting, clearing terminal ref for tab: ${activeTabIdRef.current}`
      );
      if (activeTabIdRef.current) {
        onRegisterTerminal(paneId, activeTabIdRef.current, null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, onRegisterTerminal]);

  // Swipe gesture handling for mobile session switching (terminal view only)
  const touchStartX = useRef<number | null>(null);
  const currentIndex = session
    ? sessions.findIndex((s) => s.id === session.id)
    : -1;
  const SWIPE_THRESHOLD = 120;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (viewMode !== "terminal") return;
      touchStartX.current = e.touches[0].clientX;
    },
    [viewMode]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (viewMode !== "terminal" || touchStartX.current === null) return;

      const diff = e.changedTouches[0].clientX - touchStartX.current;
      touchStartX.current = null;

      if (Math.abs(diff) <= SWIPE_THRESHOLD) return;

      const nextIndex = diff > 0 ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < sessions.length) {
        onSelectSession?.(sessions[nextIndex].id);
      }
    },
    [viewMode, currentIndex, sessions, onSelectSession]
  );

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg shadow-lg shadow-black/10 dark:shadow-black/30"
      onClick={handleFocus}
    >
      {/* Tab Bar - Mobile vs Desktop */}
      {isMobile ? (
        <MobileTabBar
          session={session}
          sessions={sessions}
          projects={projects}
          viewMode={viewMode}
          isConductor={isConductor}
          workerCount={workerCount}
          onMenuClick={onMenuClick}
          onViewModeChange={setViewMode}
          onSelectSession={onSelectSession}
        />
      ) : (
        <DesktopTabBar
          tabs={paneData.tabs}
          activeTabId={paneData.activeTabId}
          session={session}
          sessions={sessions}
          viewMode={viewMode}
          isFocused={isFocused}
          isConductor={isConductor}
          workerCount={workerCount}
          canSplit={canSplit}
          canClose={canClose}
          hasAttachedTmux={!!activeTab?.attachedTmux}
          gitDrawerOpen={gitDrawerOpen}
          onTabSwitch={(tabId) => switchTab(paneId, tabId)}
          onTabClose={(tabId) => closeTab(paneId, tabId)}
          onTabAdd={() => addTab(paneId)}
          onViewModeChange={setViewMode}
          onGitDrawerToggle={() => setGitDrawerOpen((prev) => !prev)}
          onSplitHorizontal={() => splitHorizontal(paneId)}
          onSplitVertical={() => splitVertical(paneId)}
          onClose={() => close(paneId)}
          onDetach={handleDetach}
        />
      )}

      {/* Content Area + Git Drawer in flex row */}
      <div className="flex min-h-0 flex-1">
        {/* Main Content */}
        <div
          className="relative min-h-0 min-w-0 flex-1"
          onTouchStart={isMobile ? handleTouchStart : undefined}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
        >
          {/* Terminals - one per tab, kept mounted for instant switching */}
          {paneData.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const savedState = sessionRegistry.getTerminalState(paneId, tab.id);

            return (
              <div
                key={tab.id}
                className={
                  viewMode === "terminal" && isActive ? "h-full" : "hidden"
                }
              >
                <Terminal
                  ref={getTerminalRef(tab.id)}
                  onConnected={getTerminalConnectedHandler(tab)}
                  onBeforeUnmount={(scrollState) => {
                    sessionRegistry.saveTerminalState(paneId, tab.id, {
                      scrollTop: scrollState.scrollTop,
                      scrollHeight: 0,
                      lastActivity: Date.now(),
                      cursorY: scrollState.cursorY,
                    });
                  }}
                  initialScrollState={
                    savedState
                      ? {
                          scrollTop: savedState.scrollTop,
                          cursorY: savedState.cursorY,
                          baseY: 0,
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}

          {/* Files - mounted once accessed, stays mounted */}
          {session?.working_directory && (
            <div className={viewMode === "files" ? "h-full" : "hidden"}>
              <FileExplorer
                workingDirectory={session.working_directory}
                fileEditor={fileEditor}
              />
            </div>
          )}

          {/* Git - mobile only (desktop uses GitDrawer) */}
          {isMobile && session?.working_directory && (
            <div className={viewMode === "git" ? "h-full" : "hidden"}>
              <GitPanel workingDirectory={session.working_directory} />
            </div>
          )}

          {/* Workers - only for conductor sessions */}
          {viewMode === "workers" && session && (
            <ConductorPanel
              conductorSessionId={session.id}
              onAttachToWorker={(workerId) => {
                setViewMode("terminal");
                const worker = sessions.find((s) => s.id === workerId);
                if (worker && terminalRef) {
                  const sessionName = `claude-${workerId}`;
                  terminalRef.sendInput("\x02d");
                  setTimeout(() => {
                    terminalRef?.sendInput("\x15");
                    setTimeout(() => {
                      terminalRef?.sendCommand(`tmux attach -t ${sessionName}`);
                    }, 50);
                  }, 100);
                }
              }}
            />
          )}
        </div>

        {/* Git Drawer - desktop only, pushes content */}
        {!isMobile && session?.working_directory && (
          <GitDrawer
            open={gitDrawerOpen}
            onOpenChange={setGitDrawerOpen}
            workingDirectory={session.working_directory}
          />
        )}
      </div>
    </div>
  );
});
