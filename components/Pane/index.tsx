"use client";

import { useRef, useCallback, useEffect, memo, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import type { TerminalHandle, TerminalScrollState } from "@/components/Terminal";
import type { Session } from "@/lib/db";
import { sessionRegistry } from "@/lib/client/session-registry";
import { ConductorPanel } from "@/components/ConductorPanel";
import type { GitFile } from "@/lib/git-status";
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

const DiffModal = dynamic(
  () => import("@/components/DiffViewer/DiffModal").then((mod) => mod.DiffModal),
  { ssr: false }
);

interface PaneProps {
  paneId: string;
  sessions: Session[];
  onRegisterTerminal: (paneId: string, tabId: string, ref: TerminalHandle | null) => void;
  onMenuClick?: () => void;
  onSelectSession?: (sessionId: string) => void;
}

type ViewMode = "terminal" | "files" | "git" | "workers";

export const Pane = memo(function Pane({
  paneId,
  sessions,
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
  const [selectedDiff, setSelectedDiff] = useState<{ file: GitFile; diff: string } | null>(null);
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

  // Reset view mode and diff when session changes
  useEffect(() => {
    setViewMode("terminal");
    setSelectedDiff(null);
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

  // Register terminal when connected
  const handleTerminalConnected = useCallback(() => {
    if (terminalRef.current && activeTab) {
      onRegisterTerminal(paneId, activeTab.id, terminalRef.current);

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

  const handleSelectSession = useCallback((sessionId: string) => {
    if (onSelectSession) {
      onSelectSession(sessionId);
    }
  }, [onSelectSession]);

  // Swipe gesture handling for mobile session switching
  const touchStartX = useRef<number | null>(null);
  const currentIndex = session ? sessions.findIndex(s => s.id === session.id) : -1;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX.current;
    const threshold = 75; // Minimum swipe distance

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
  }, [currentIndex, sessions, handleSelectSession]);

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

      {/* Content Area */}
      <div
        className="flex-1 min-h-0"
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
      >
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
          <>
            <GitPanel
              workingDirectory={session.working_directory}
              onFileSelect={(file, diff) => setSelectedDiff({ file, diff })}
            />
            {selectedDiff && (
              <DiffModal
                diff={selectedDiff.diff}
                fileName={selectedDiff.file.path}
                isStaged={selectedDiff.file.staged}
                onClose={() => setSelectedDiff(null)}
              />
            )}
          </>
        )}
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
