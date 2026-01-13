"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { Pane } from "@/components/Pane";
import { useNotifications } from "@/hooks/useNotifications";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import type { Session, Group } from "@/lib/db";
import type { TerminalHandle } from "@/components/Terminal";
import { getProvider } from "@/lib/providers";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";
import type { SessionStatus } from "@/components/views/types";

interface ExternalTmuxSession {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  claudeSessionId?: string | null;
}

// Main content component that uses pane context
function HomeContent() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);
  const importedTmuxSessions = useRef<Set<string>>(new Set());
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map());
  const updatedSessionIds = useRef<Set<string>>(new Set());

  const { focusedPaneId, attachSession, getActiveTab } = usePanes();
  const focusedActiveTab = getActiveTab(focusedPaneId);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const { isMobile } = useViewport();

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
      // Fallback to raw command if API fails
      return agentCommand;
    }
  }, []);

  // Set CSS variable for viewport height (handles mobile keyboard)
  useViewportHeight();

  // Callback for notification clicks - needs to be defined before useNotifications
  const handleNotificationClick = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      const terminal = terminalRefs.current.get(`${focusedPaneId}:${getActiveTab(focusedPaneId)?.id}`);
      if (terminal) {
        const provider = getProvider(session.agent_type || "claude");
        const sessionName = `${provider.id}-${session.id}`;
        const cwd = session.working_directory?.replace('~', '$HOME') || '$HOME';

        // Ensure MCP config exists for orchestration
        fetch(`/api/sessions/${session.id}/mcp-config`, { method: "POST" }).catch(() => {});

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

        terminal.sendInput("\x02d");
        setTimeout(() => {
          terminal.sendInput("\x15");
          setTimeout(async () => {
            const agentCmd = `${provider.command} ${flagsStr}`;
            const newSessionCmd = await getInitScriptCommand(agentCmd);
            terminal.sendCommand(`tmux attach -t ${sessionName} 2>/dev/null || tmux new -s ${sessionName} -c "${cwd}" "${newSessionCmd}"`);
            attachSession(focusedPaneId, session.id, sessionName);
          }, 50);
        }, 100);
      }
    }
  }, [sessions, focusedPaneId, getActiveTab, attachSession, getInitScriptCommand]);

  const { settings: notificationSettings, checkStateChanges, updateSettings, requestPermission, permissionGranted } = useNotifications({
    onSessionClick: handleNotificationClick,
  });

  // Register terminal ref for a pane+tab
  const registerTerminalRef = useCallback((paneId: string, tabId: string, ref: TerminalHandle | null) => {
    const key = `${paneId}:${tabId}`;
    if (ref) {
      terminalRefs.current.set(key, ref);
    } else {
      terminalRefs.current.delete(key);
    }
  }, []);

  // Get terminal for focused pane's active tab
  const getFocusedTerminal = useCallback(() => {
    const activeTab = getActiveTab(focusedPaneId);
    if (!activeTab) return undefined;
    return terminalRefs.current.get(`${focusedPaneId}:${activeTab.id}`);
  }, [focusedPaneId, getActiveTab]);

  // Fetch all sessions and groups
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
      setGroups(data.groups || []);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    }
  }, []);

  // Fetch session statuses from tmux and auto-import external sessions
  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/status");
      const data = await res.json();
      const statuses = data.statuses || {};
      setSessionStatuses(statuses);

      // Check for notification-worthy state changes
      const sessionStates = sessions.map(s => ({
        id: s.id,
        name: s.name,
        status: statuses[s.id]?.status || "dead",
      }));
      checkStateChanges(sessionStates);

      // Check for new Claude session IDs and update DB (only once per session)
      let needsRefresh = false;
      for (const [sessionId, status] of Object.entries(statuses) as [string, SessionStatus][]) {
        if (status.claudeSessionId && !updatedSessionIds.current.has(sessionId)) {
          updatedSessionIds.current.add(sessionId);
          await fetch(`/api/sessions/${sessionId}/claude-session`);
          needsRefresh = true;
        }
      }

      // Auto-import external tmux sessions (sessions not managed by AgentOS)
      const externalSessions = (data.otherSessions || []) as ExternalTmuxSession[];
      for (const extSession of externalSessions) {
        // Skip if already imported or currently importing
        if (importedTmuxSessions.current.has(extSession.sessionName)) continue;

        try {
          // Mark as importing to avoid duplicate attempts
          importedTmuxSessions.current.add(extSession.sessionName);

          // Import the session
          const importRes = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: extSession.sessionName,
              claudeSessionId: extSession.claudeSessionId,
              importFromTmux: extSession.sessionName,
            }),
          });

          if (importRes.ok) {
            const importData = await importRes.json();
            if (importData.session) {
              // Rename tmux session to match our naming convention
              const newTmuxName = `claude-${importData.session.id}`;
              await fetch("/api/tmux/rename", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ oldName: extSession.sessionName, newName: newTmuxName }),
              });
              needsRefresh = true;
            }
          } else {
            // Import failed, allow retry on next poll
            importedTmuxSessions.current.delete(extSession.sessionName);
          }
        } catch (importError) {
          // Import failed, allow retry on next poll
          importedTmuxSessions.current.delete(extSession.sessionName);
          console.error(`Failed to auto-import session ${extSession.sessionName}:`, importError);
        }
      }

      if (needsRefresh) {
        const sessRes = await fetch("/api/sessions");
        const sessData = await sessRes.json();
        setSessions(sessData.sessions || []);
      }
    } catch (error) {
      console.error("Failed to fetch statuses:", error);
    }
  }, [sessions, checkStateChanges]);

  // Set initial sidebar state based on viewport
  useEffect(() => {
    if (!isMobile) setSidebarOpen(true);
  }, [isMobile]);

  // Initial load
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Poll for status every 3 seconds
  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 3000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  // Poll for new sessions every 10 seconds (for workers spawned via MCP)
  useEffect(() => {
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

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

  // Memoized pane renderer to prevent unnecessary re-renders
  const renderPane = useCallback((paneId: string) => (
    <Pane
      key={paneId}
      paneId={paneId}
      sessions={sessions}
      onRegisterTerminal={registerTerminalRef}
      onMenuClick={isMobile ? () => setSidebarOpen(true) : undefined}
    />
  ), [sessions, registerTerminalRef, isMobile]);

  // Attach session to focused pane
  const attachToSession = useCallback(async (session: Session) => {
    const terminal = getFocusedTerminal();
    if (terminal) {
      // Get the provider for this session's agent type
      const provider = getProvider(session.agent_type || "claude");
      const sessionName = `${provider.id}-${session.id}`;
      const cwd = session.working_directory?.replace('~', '$HOME') || '$HOME';

      // Ensure MCP config exists for orchestration (fire and forget)
      fetch(`/api/sessions/${session.id}/mcp-config`, { method: "POST" }).catch(() => {});

      // Get parent session ID for forking
      let parentSessionId: string | null = null;
      if (!session.claude_session_id && session.parent_session_id) {
        const parentSession = sessions.find(s => s.id === session.parent_session_id);
        parentSessionId = parentSession?.claude_session_id || null;
      }

      // Build flags using the provider
      const flags = provider.buildFlags({
        sessionId: session.claude_session_id,
        parentSessionId,
        autoApprove: session.auto_approve,
        model: session.model,
      });

      const flagsStr = flags.join(" ");

      terminal.sendInput("\x02d");
      setTimeout(() => {
        terminal.sendInput("\x15");
        setTimeout(async () => {
          const agentCmd = `${provider.command} ${flagsStr}`;
          const newSessionCmd = await getInitScriptCommand(agentCmd);
          terminal.sendCommand(`tmux attach -t ${sessionName} 2>/dev/null || tmux new -s ${sessionName} -c "${cwd}" "${newSessionCmd}"`);
          attachSession(focusedPaneId, session.id, sessionName);
          // Focus terminal after attaching
          terminal.focus();
        }, 50);
      }, 100);
    }
  }, [getFocusedTerminal, focusedPaneId, attachSession, sessions, getInitScriptCommand]);

  // Create new session and attach
  const createAndAttach = async () => {
    try {
      // Get saved agent type preference
      const savedAgentType = localStorage.getItem("agentOS:defaultAgentType") || "claude";
      const provider = getProvider(savedAgentType as "claude" | "codex" | "opencode");

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Session ${sessions.length + 1}`,
          agentType: savedAgentType,
        }),
      });
      const data = await res.json();
      if (data.session) {
        await fetchSessions();
        const terminal = getFocusedTerminal();
        if (terminal) {
          terminal.sendInput("\x02d");
          setTimeout(() => {
            terminal.sendInput("\x15");
            setTimeout(async () => {
              const cwd = data.session.working_directory?.replace('~', '$HOME') || '$HOME';
              const sessionName = `${provider.id}-${data.session.id}`;
              const flags = provider.buildFlags({ autoApprove: data.session.auto_approve });
              const flagsStr = flags.join(" ");
              const agentCmd = `${provider.command} ${flagsStr}`;
              const newSessionCmd = await getInitScriptCommand(agentCmd);
              terminal.sendCommand(`tmux new -s ${sessionName} -c "${cwd}" "${newSessionCmd}"`);
              attachSession(focusedPaneId, data.session.id, sessionName);
            }, 50);
          }, 100);
        }
      }
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  // Toggle group expanded state
  const handleToggleGroup = async (path: string, expanded: boolean) => {
    try {
      await fetch(`/api/groups/${encodeURIComponent(path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded }),
      });
      setGroups(prev => prev.map(g =>
        g.path === path ? { ...g, expanded } : g
      ));
    } catch (error) {
      console.error("Failed to toggle group:", error);
    }
  };

  // Create new group
  const handleCreateGroup = async (name: string, parentPath?: string) => {
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentPath }),
      });
      if (res.ok) {
        await fetchSessions();
      }
    } catch (error) {
      console.error("Failed to create group:", error);
    }
  };

  // Delete group
  const handleDeleteGroup = async (path: string) => {
    if (!confirm("Delete this group? Sessions will be moved to parent.")) return;
    try {
      await fetch(`/api/groups/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
  };

  // Move session to group
  const handleMoveSession = async (sessionId: string, groupPath: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupPath }),
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to move session:", error);
    }
  };

  // Fork session
  const handleForkSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/fork`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.session) {
        await fetchSessions();
        // Optionally attach to the forked session
        attachToSession(data.session);
      }
    } catch (error) {
      console.error("Failed to fork session:", error);
    }
  };

  // Delete session
  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  };

  // Rename session
  const handleRenameSession = async (sessionId: string, newName: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to rename session:", error);
    }
  };

  // Create PR for worktree session
  const handleCreatePR = async (sessionId: string) => {
    try {
      const session = sessions.find(s => s.id === sessionId);
      if (!session) return;

      // First check if PR already exists
      const checkRes = await fetch(`/api/sessions/${sessionId}/pr`);
      const checkData = await checkRes.json();

      if (checkData.pr) {
        // PR exists, open it
        window.open(checkData.pr.url, "_blank");
        return;
      }

      // Create new PR
      const res = await fetch(`/api/sessions/${sessionId}/pr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: session.name,
        }),
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
  };

  // Get active session from focused pane's active tab
  const activeSession = sessions.find(s => s.id === focusedActiveTab?.sessionId);

  // Shared props for views
  const viewProps = {
    sessions,
    groups,
    sessionStatuses,
    sidebarOpen,
    setSidebarOpen,
    activeSession,
    focusedActiveTab,
    copiedSessionId,
    setCopiedSessionId,
    showNewSessionDialog,
    setShowNewSessionDialog,
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
    handleToggleGroup,
    handleCreateGroup,
    handleDeleteGroup,
    handleMoveSession,
    handleForkSession,
    handleDeleteSession,
    handleRenameSession,
    handleCreatePR,
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
