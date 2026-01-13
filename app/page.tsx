"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { Pane } from "@/components/Pane";
import { useNotifications } from "@/hooks/useNotifications";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useSessions } from "@/hooks/useSessions";
import { useProjects } from "@/hooks/useProjects";
import { useGroups } from "@/hooks/useGroups";
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
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map());

  // Pane context
  const { focusedPaneId, attachSession, getActiveTab } = usePanes();
  const focusedActiveTab = getActiveTab(focusedPaneId);
  const { isMobile } = useViewport();

  // Data hooks
  const {
    sessions,
    groups,
    summarizingSessionId,
    fetchSessions,
    deleteSession,
    renameSession,
    forkSession,
    summarizeSession,
    moveSessionToGroup,
    moveSessionToProject,
    setSessions,
    setGroups,
    updatedSessionIds,
  } = useSessions();

  const {
    projects,
    fetchProjects,
    toggleProject,
    deleteProject,
    renameProject,
    setProjects,
  } = useProjects(fetchSessions);

  const {
    toggleGroup,
    createGroup,
    deleteGroup,
  } = useGroups(setGroups, fetchSessions);

  const {
    devServers,
    startDevServerProjectId,
    setStartDevServerProjectId,
    startDevServer,
    stopDevServer,
    restartDevServer,
    removeDevServer,
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
    } else {
      terminalRefs.current.delete(key);
    }
  }, []);

  // Get terminal for a pane, with fallback to first available
  const getTerminalWithFallback = useCallback((): { terminal: TerminalHandle; paneId: string; tabId: string } | undefined => {
    // Try focused pane first
    const activeTab = getActiveTab(focusedPaneId);
    if (activeTab) {
      const terminal = terminalRefs.current.get(`${focusedPaneId}:${activeTab.id}`);
      if (terminal) {
        return { terminal, paneId: focusedPaneId, tabId: activeTab.id };
      }
    }

    // Fallback to first available terminal
    const firstEntry = terminalRefs.current.entries().next().value;
    if (firstEntry) {
      const [key, terminal] = firstEntry as [string, TerminalHandle];
      const [paneId, tabId] = key.split(":");
      return { terminal, paneId, tabId };
    }

    return undefined;
  }, [focusedPaneId, getActiveTab]);

  // Attach session to terminal
  const attachToSession = useCallback(async (session: Session) => {
    const terminalInfo = getTerminalWithFallback();
    if (!terminalInfo) {
      console.warn("[AgentOS] No terminal available to attach session:", session.name);
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
    updatedSessionIds,
    setSessions,
    checkStateChanges,
  });

  // Initial data load
  useEffect(() => {
    fetchSessions();
    fetchProjects();
  }, [fetchSessions, fetchProjects]);

  // Poll for new sessions every 10 seconds (for workers spawned via MCP)
  useEffect(() => {
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

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
    const session = sessions.find(s => s.id === sessionId);
    if (session) attachToSession(session);
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

  // Project edit handler
  const [showProjectSettings, setShowProjectSettings] = useState<typeof projects[0] | null>(null);
  const handleEditProject = useCallback((projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project) setShowProjectSettings(project);
  }, [projects]);

  // New session in project handler
  const handleNewSessionInProject = useCallback((projectId: string) => {
    setNewSessionProjectId(projectId);
    setShowNewSessionDialog(true);
  }, []);

  // Fork session and attach
  const handleForkSession = useCallback(async (sessionId: string) => {
    const forkedSession = await forkSession(sessionId);
    if (forkedSession) attachToSession(forkedSession);
  }, [forkSession, attachToSession]);

  // Summarize session and attach to new session
  const handleSummarize = useCallback(async (sessionId: string) => {
    const newSession = await summarizeSession(sessionId);
    if (newSession) attachToSession(newSession);
  }, [summarizeSession, attachToSession]);

  // Create PR handler
  const handleCreatePR = useCallback(async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    try {
      const checkRes = await fetch(`/api/sessions/${sessionId}/pr`);
      const checkData = await checkRes.json();

      if (checkData.pr) {
        window.open(checkData.pr.url, "_blank");
        return;
      }

      const res = await fetch(`/api/sessions/${sessionId}/pr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: session.name }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      if (data.pr?.url) {
        window.open(data.pr.url, "_blank");
      }
    } catch (error) {
      console.error("Failed to create PR:", error);
      alert("Failed to create PR. Make sure gh CLI is installed and authenticated.");
    }
  }, [sessions]);

  // Active session and dev server project
  const activeSession = sessions.find(s => s.id === focusedActiveTab?.sessionId);
  const startDevServerProject = startDevServerProjectId
    ? projects.find(p => p.id === startDevServerProjectId) ?? null
    : null;

  // View props
  const viewProps = {
    sessions,
    groups,
    projects,
    sessionStatuses,
    summarizingSessionId,
    devServers,
    sidebarOpen,
    setSidebarOpen,
    activeSession,
    focusedActiveTab,
    copiedSessionId,
    setCopiedSessionId,
    showNewSessionDialog,
    setShowNewSessionDialog: (show: boolean) => {
      setShowNewSessionDialog(show);
      if (!show) setNewSessionProjectId(null); // Clear project when closing
    },
    newSessionProjectId,
    showNewProjectDialog,
    setShowNewProjectDialog,
    showProjectSettings,
    setShowProjectSettings,
    showNotificationSettings,
    setShowNotificationSettings,
    showQuickSwitcher,
    setShowQuickSwitcher,
    notificationSettings,
    permissionGranted,
    updateSettings,
    requestPermission,
    attachToSession,
    fetchSessions,
    fetchProjects,
    handleToggleGroup: toggleGroup,
    handleCreateGroup: createGroup,
    handleDeleteGroup: deleteGroup,
    handleMoveSession: moveSessionToGroup,
    handleToggleProject: toggleProject,
    handleEditProject,
    handleDeleteProject: deleteProject,
    handleRenameProject: renameProject,
    handleMoveSessionToProject: moveSessionToProject,
    handleNewSessionInProject,
    handleForkSession,
    handleSummarize,
    handleDeleteSession: deleteSession,
    handleRenameSession: renameSession,
    handleCreatePR,
    handleStartDevServer: startDevServer,
    handleStopDevServer: stopDevServer,
    handleRestartDevServer: restartDevServer,
    handleRemoveDevServer: removeDevServer,
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
