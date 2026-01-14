"use client";

import { useRef, useCallback, useEffect, memo, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import type { TerminalHandle, TerminalScrollState } from "@/components/Terminal";
import type { Session, Project } from "@/lib/db";
import { sessionRegistry } from "@/lib/client/session-registry";
import { ConductorPanel } from "@/components/ConductorPanel";
import { useFileEditor } from "@/hooks/useFileEditor";
import { MobileTabBar } from "./MobileTabBar";
import { DesktopTabBar } from "./DesktopTabBar";

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
  projects: Project[];
  onRegisterTerminal: (paneId: string, tabId: string, ref: TerminalHandle | null) => void;
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
  const terminalRef = useRef<TerminalHandle>(null);
  const paneData = getPaneData(paneId);
  const activeTab = getActiveTab(paneId);
  const isFocused = focusedPaneId === paneId;
  const session = activeTab ? sessions.find((s) => s.id === activeTab.sessionId) : null;

  // File editor state - lifted here so it persists across view switches
  const fileEditor = useFileEditor();

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
        baseY: 0,
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

  // Reset view mode and file editor when session changes
  useEffect(() => {
    setViewMode("terminal");
    fileEditor.reset();
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFocus = useCallback(() => {
    focusPane(paneId);
  }, [focusPane, paneId]);

  const handleDetach = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.sendInput("\x02d"); // Ctrl+B d to detach
    }
    detachSession(paneId);
  }, [detachSession, paneId]);

  // Register terminal when connected
  const handleTerminalConnected = useCallback(() => {
    console.log(`[AgentOS] Terminal connected for pane: ${paneId}, activeTab: ${activeTab?.id || 'null'}`);
    if (terminalRef.current && activeTab) {
      onRegisterTerminal(paneId, activeTab.id, terminalRef.current);

      // Use fresh session tmux_name from database, not cached attachedTmux
      // This ensures renamed sessions attach correctly
      if (activeTab.sessionId) {
        const currentSession = sessions.find(s => s.id === activeTab.sessionId);
        const tmuxName = currentSession?.tmux_name || activeTab.attachedTmux;
        if (tmuxName) {
          setTimeout(() => {
            terminalRef.current?.sendCommand(`tmux attach -t ${tmuxName}`);
          }, 100);
        }
      } else if (activeTab.attachedTmux) {
        // Fallback for tabs without sessionId (e.g., manually attached)
        setTimeout(() => {
          terminalRef.current?.sendCommand(`tmux attach -t ${activeTab.attachedTmux}`);
        }, 100);
      }
    } else {
      console.log(`[AgentOS] Cannot register terminal - ref: ${!!terminalRef.current}, activeTab: ${!!activeTab}`);
    }
  }, [paneId, activeTab, sessions, onRegisterTerminal]);

  // Track current tab ID for cleanup
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTab?.id || null;

  // Cleanup on unmount only
  useEffect(() => {
    console.log(`[AgentOS] Pane ${paneId} mounted, activeTab: ${activeTab?.id || 'null'}`);
    return () => {
      console.log(`[AgentOS] Pane ${paneId} unmounting, clearing terminal ref for tab: ${activeTabIdRef.current}`);
      if (activeTabIdRef.current) {
        onRegisterTerminal(paneId, activeTabIdRef.current, null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, onRegisterTerminal]);

  const handleSelectSession = useCallback(
    (sessionId: string) => onSelectSession?.(sessionId),
    [onSelectSession]
  );

  // Swipe gesture handling for mobile session switching (terminal view only)
  const touchStartX = useRef<number | null>(null);
  const currentIndex = session ? sessions.findIndex(s => s.id === session.id) : -1;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only enable swipe on terminal view
    if (viewMode !== "terminal") return;
    touchStartX.current = e.touches[0].clientX;
  }, [viewMode]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Only enable swipe on terminal view
    if (viewMode !== "terminal") return;
    if (touchStartX.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX.current;
    const threshold = 120; // Minimum swipe distance (increased to reduce sensitivity)

    if (Math.abs(diff) > threshold) {
      if (diff > 0 && currentIndex > 0) {
        // Swipe right -> previous session
        handleSelectSession(sessions[currentIndex - 1].id);
      } else if (diff < 0 && currentIndex < sessions.length - 1) {
        // Swipe left -> next session
        handleSelectSession(sessions[currentIndex + 1].id);
      }
    }

    touchStartX.current = null;
  }, [viewMode, currentIndex, sessions, handleSelectSession]);

  return (
    <div
      className="flex flex-col h-full rounded-lg overflow-hidden shadow-lg shadow-black/10 dark:shadow-black/30"
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
          onSelectSession={handleSelectSession}
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
          onTabSwitch={(tabId) => switchTab(paneId, tabId)}
          onTabClose={(tabId) => closeTab(paneId, tabId)}
          onTabAdd={() => addTab(paneId)}
          onViewModeChange={setViewMode}
          onSplitHorizontal={() => splitHorizontal(paneId)}
          onSplitVertical={() => splitVertical(paneId)}
          onClose={() => close(paneId)}
          onDetach={handleDetach}
        />
      )}

      {/* Content Area - components stay mounted but hidden for instant switching */}
      <div
        className="flex-1 min-h-0 relative"
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
      >
        {/* Terminal - always mounted to maintain WebSocket connection */}
        <div className={viewMode === "terminal" ? "h-full" : "hidden"}>
          <Terminal
            key={activeTab?.id}
            ref={terminalRef}
            onConnected={handleTerminalConnected}
            onDisconnected={() => {}}
            onBeforeUnmount={handleBeforeUnmount}
            initialScrollState={initialScrollState}
          />
        </div>

        {/* Files - mounted once accessed, stays mounted */}
        {session?.working_directory && (
          <div className={viewMode === "files" ? "h-full" : "hidden"}>
            <FileExplorer
              workingDirectory={session.working_directory}
              fileEditor={fileEditor}
            />
          </div>
        )}

        {/* Git - mounted once accessed, stays mounted */}
        {session?.working_directory && (
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
