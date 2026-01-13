"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Debug log buffer - persists even if console is closed
const debugLogs: string[] = [];
const MAX_DEBUG_LOGS = 100;

function debugLog(message: string) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const entry = `[${timestamp}] ${message}`;
  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  console.log(`[AgentOS] ${message}`);
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as unknown as { agentOSLogs: () => void }).agentOSLogs = () => {
    console.log('=== AgentOS Debug Logs ===');
    debugLogs.forEach(log => console.log(log));
    console.log('=== End Logs ===');
  };
}
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { Pane } from "@/components/Pane";
import { useNotifications } from "@/hooks/useNotifications";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useSessions } from "@/hooks/useSessions";
import { useProjects } from "@/hooks/useProjects";
import { useDevServersManager } from "@/hooks/useDevServersManager";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import type { Session } from "@/lib/db";
import type { TerminalHandle } from "@/components/Terminal";
import { getProvider } from "@/lib/providers";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";

function HomeContent() {
  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map());

  // Pane context
  const { focusedPaneId, attachSession, getActiveTab, addTab } = usePanes();
  const focusedActiveTab = getActiveTab(focusedPaneId);
  const { isMobile } = useViewport();

  // Data hooks
  const { sessions, fetchSessions } = useSessions();
  const { projects, fetchProjects } = useProjects();
  const {
    startDevServerProjectId,
    setStartDevServerProjectId,
    startDevServer,
    createDevServer,
  } = useDevServersManager();

  // Helper to get init script command from API
  const getInitScriptCommand = useCallback(async (agentCommand: string): Promise<string> => {
    try {
      const res = await fetch("/api/sessions/init-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentCommand }),
      });
      const data = await res.json();
      return data.command || agentCommand;
    } catch {
      return agentCommand;
    }
  }, []);

  // Set CSS variable for viewport height (handles mobile keyboard)
  useViewportHeight();

  // Terminal ref management
  const registerTerminalRef = useCallback((paneId: string, tabId: string, ref: TerminalHandle | null) => {
    const key = `${paneId}:${tabId}`;
    if (ref) {
      terminalRefs.current.set(key, ref);
      debugLog(`Terminal registered: ${key}, total refs: ${terminalRefs.current.size}`);
    } else {
      terminalRefs.current.delete(key);
      debugLog(`Terminal unregistered: ${key}, total refs: ${terminalRefs.current.size}`);
    }
  }, []);

  // Get terminal for a pane, with fallback to first available
  const getTerminalWithFallback = useCallback((): { terminal: TerminalHandle; paneId: string; tabId: string } | undefined => {
    debugLog(`getTerminalWithFallback called, total refs: ${terminalRefs.current.size}, focusedPaneId: ${focusedPaneId}`);

    // Try focused pane first
    const activeTab = getActiveTab(focusedPaneId);
    debugLog(`activeTab for focused pane: ${activeTab?.id || 'null'}`);

    if (activeTab) {
      const key = `${focusedPaneId}:${activeTab.id}`;
      const terminal = terminalRefs.current.get(key);
      debugLog(`Looking for terminal at key "${key}": ${terminal ? 'found' : 'not found'}`);
      if (terminal) {
        return { terminal, paneId: focusedPaneId, tabId: activeTab.id };
      }
    }

    // Fallback to first available terminal
    const firstEntry = terminalRefs.current.entries().next().value;
    if (firstEntry) {
      const [key, terminal] = firstEntry as [string, TerminalHandle];
      const [paneId, tabId] = key.split(":");
      debugLog(`Using fallback terminal: ${key}`);
      return { terminal, paneId, tabId };
    }

    debugLog(`NO TERMINAL FOUND. Available keys: ${Array.from(terminalRefs.current.keys()).join(', ') || 'none'}`);
    return undefined;
  }, [focusedPaneId, getActiveTab]);

  // Attach session to terminal
  const attachToSession = useCallback(async (session: Session) => {
    const terminalInfo = getTerminalWithFallback();
    if (!terminalInfo) {
      debugLog(`ERROR: No terminal available to attach session: ${session.name}`);
      alert(`[AgentOS Debug] No terminal available!\n\nRun agentOSLogs() in console to see debug logs.`);
      return;
    }

    const { terminal, paneId } = terminalInfo;

    const provider = getProvider(session.agent_type || "claude");
    const sessionName = `${provider.id}-${session.id}`;
    const cwd = session.working_directory?.replace("~", "$HOME") || "$HOME";

    // Ensure MCP config exists for orchestration
    fetch(`/api/sessions/${session.id}/mcp-config`, { method: "POST" }).catch(() => {});

    // Get parent session ID for forking
    let parentSessionId: string | null = null;
    if (!session.claude_session_id && session.parent_session_id) {
      const parentSession = sessions.find(s => s.id === session.parent_session_id);
      parentSessionId = parentSession?.claude_session_id || null;
    }

    const flags = provider.buildFlags({
      sessionId: session.claude_session_id,
      parentSessionId,
      autoApprove: session.auto_approve,
      model: session.model,
    });
    const flagsStr = flags.join(" ");

    // Check if we're currently attached to a tmux session
    const activeTab = getActiveTab(paneId);
    const isInTmux = !!activeTab?.attachedTmux;

    if (isInTmux) {
      terminal.sendInput("\x02d");
    }

    setTimeout(() => {
      terminal.sendInput("\x03");
      setTimeout(async () => {
        const agentCmd = `${provider.command} ${flagsStr}`;
        const newSessionCmd = await getInitScriptCommand(agentCmd);
        terminal.sendCommand(`tmux attach -t ${sessionName} 2>/dev/null || tmux new -s ${sessionName} -c "${cwd}" "${newSessionCmd}"`);
        attachSession(paneId, session.id, sessionName);
        terminal.focus();
      }, 50);
    }, isInTmux ? 100 : 0);
  }, [getTerminalWithFallback, attachSession, sessions, getInitScriptCommand, getActiveTab]);

  // Open session in new tab
  const openSessionInNewTab = useCallback((session: Session) => {
    // Snapshot existing terminal keys before adding new tab
    const existingKeys = new Set(terminalRefs.current.keys());

    // Add a new tab (which becomes active)
    addTab(focusedPaneId);

    // Poll for a NEW terminal to appear in this pane
    let attempts = 0;
    const maxAttempts = 20; // 20 * 50ms = 1 second max wait

    const waitForNewTerminal = () => {
      attempts++;

      // Find a terminal key that didn't exist before (in the focused pane)
      for (const key of terminalRefs.current.keys()) {
        if (!existingKeys.has(key) && key.startsWith(`${focusedPaneId}:`)) {
          // Found the new terminal! Now attach the session using it directly
          const terminal = terminalRefs.current.get(key);
          if (terminal) {
            const provider = getProvider(session.agent_type || "claude");
            const sessionName = `${provider.id}-${session.id}`;
            const cwd = session.working_directory?.replace("~", "$HOME") || "$HOME";

            // Ensure MCP config exists
            fetch(`/api/sessions/${session.id}/mcp-config`, { method: "POST" }).catch(() => {});

            // Get parent session ID for forking
            let parentSessionId: string | null = null;
            if (!session.claude_session_id && session.parent_session_id) {
              const parentSession = sessions.find(s => s.id === session.parent_session_id);
              parentSessionId = parentSession?.claude_session_id || null;
            }

            const flags = provider.buildFlags({
              sessionId: session.claude_session_id,
              parentSessionId,
              autoApprove: session.auto_approve,
              model: session.model,
            });
            const flagsStr = flags.join(" ");

            // Run tmux command in the new terminal
            (async () => {
              const agentCmd = `${provider.command} ${flagsStr}`;
              const newSessionCmd = await getInitScriptCommand(agentCmd);
              terminal.sendCommand(`tmux attach -t ${sessionName} 2>/dev/null || tmux new -s ${sessionName} -c "${cwd}" "${newSessionCmd}"`);
              attachSession(focusedPaneId, session.id, sessionName);
              terminal.focus();
            })();
            return;
          }
        }
      }

      // Keep polling if new terminal not found yet
      if (attempts < maxAttempts) {
        setTimeout(waitForNewTerminal, 50);
      } else {
        debugLog(`Failed to find new terminal after ${maxAttempts} attempts`);
      }
    };

    // Start polling after initial delay for React to process state update
    setTimeout(waitForNewTerminal, 50);
  }, [addTab, focusedPaneId, attachSession, sessions, getInitScriptCommand]);

  // Notification click handler
  const handleNotificationClick = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      attachToSession(session);
    }
  }, [sessions, attachToSession]);

  // Notifications
  const {
    settings: notificationSettings,
    checkStateChanges,
    updateSettings,
    requestPermission,
    permissionGranted,
  } = useNotifications({ onSessionClick: handleNotificationClick });

  // Session statuses
  const { sessionStatuses } = useSessionStatuses({
    sessions,
    activeSessionId: focusedActiveTab?.sessionId,
    checkStateChanges,
  });

  // Set initial sidebar state based on viewport
  useEffect(() => {
    if (!isMobile) setSidebarOpen(true);
  }, [isMobile]);

  // Keyboard shortcut: Cmd+K to open quick switcher
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowQuickSwitcher(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Session selection handler
  const handleSelectSession = useCallback((sessionId: string) => {
    debugLog(`handleSelectSession called for: ${sessionId}`);
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      debugLog(`Found session: ${session.name}, calling attachToSession`);
      attachToSession(session);
    } else {
      debugLog(`Session not found in sessions array (length: ${sessions.length})`);
    }
  }, [sessions, attachToSession]);

  // Pane renderer
  const renderPane = useCallback((paneId: string) => (
    <Pane
      key={paneId}
      paneId={paneId}
      sessions={sessions}
      projects={projects}
      onRegisterTerminal={registerTerminalRef}
      onMenuClick={isMobile ? () => setSidebarOpen(true) : undefined}
      onSelectSession={handleSelectSession}
    />
  ), [sessions, projects, registerTerminalRef, isMobile, handleSelectSession]);

  // New session in project handler
  const handleNewSessionInProject = useCallback((projectId: string) => {
    setNewSessionProjectId(projectId);
    setShowNewSessionDialog(true);
  }, []);

  // Active session and dev server project
  const activeSession = sessions.find(s => s.id === focusedActiveTab?.sessionId);
  const startDevServerProject = startDevServerProjectId
    ? projects.find(p => p.id === startDevServerProjectId) ?? null
    : null;

  // View props
  const viewProps = {
    sessions,
    projects,
    sessionStatuses,
    sidebarOpen,
    setSidebarOpen,
    activeSession,
    focusedActiveTab,
    copiedSessionId,
    setCopiedSessionId,
    showNewSessionDialog,
    setShowNewSessionDialog: (show: boolean) => {
      setShowNewSessionDialog(show);
      if (!show) setNewSessionProjectId(null);
    },
    newSessionProjectId,
    showNotificationSettings,
    setShowNotificationSettings,
    showQuickSwitcher,
    setShowQuickSwitcher,
    notificationSettings,
    permissionGranted,
    updateSettings,
    requestPermission,
    attachToSession,
    openSessionInNewTab,
    fetchSessions,
    fetchProjects,
    handleNewSessionInProject,
    handleStartDevServer: startDevServer,
    handleCreateDevServer: createDevServer,
    startDevServerProject,
    setStartDevServerProjectId,
    renderPane,
  };

  if (isMobile) {
    return <MobileView {...viewProps} />;
  }

  return <DesktopView {...viewProps} />;
}

export default function Home() {
  return (
    <PaneProvider>
      <HomeContent />
    </PaneProvider>
  );
}
