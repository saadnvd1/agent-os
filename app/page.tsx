"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeft, Plus } from "lucide-react";
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { PaneLayout } from "@/components/PaneLayout";
import { Pane } from "@/components/Pane";
import type { Session, Group } from "@/lib/db";
import type { TerminalHandle } from "@/components/Terminal";
import { getProvider } from "@/lib/providers";

interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  claudeSessionId?: string | null;
}

interface OtherTmuxSession {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  claudeSessionId?: string | null;
}

// Main content component that uses pane context
function HomeContent() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [otherTmuxSessions, setOtherTmuxSessions] = useState<OtherTmuxSession[]>([]);
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map());
  const updatedSessionIds = useRef<Set<string>>(new Set());

  const { focusedPaneId, attachSession, getActiveTab } = usePanes();
  const focusedActiveTab = getActiveTab(focusedPaneId);

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

  // Fetch session statuses from tmux
  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/status");
      const data = await res.json();
      setSessionStatuses(data.statuses || {});
      setOtherTmuxSessions(data.otherSessions || []);

      // Check for new Claude session IDs and update DB (only once per session)
      const statuses = data.statuses || {};
      let needsRefresh = false;
      for (const [sessionId, status] of Object.entries(statuses) as [string, SessionStatus][]) {
        if (status.claudeSessionId && !updatedSessionIds.current.has(sessionId)) {
          updatedSessionIds.current.add(sessionId);
          await fetch(`/api/sessions/${sessionId}/claude-session`);
          needsRefresh = true;
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
  }, []);

  // Initial load
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Poll for status every 2 seconds
  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 2000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  // Attach session to focused pane
  const attachToSession = useCallback((session: Session) => {
    const terminal = getFocusedTerminal();
    if (terminal) {
      // Get the provider for this session's agent type
      const provider = getProvider(session.agent_type || "claude");
      const sessionName = `${provider.id}-${session.id}`;
      const cwd = session.working_directory?.replace('~', '$HOME') || '$HOME';

      // Check if user wants to skip permissions (from localStorage)
      const skipPermissions = localStorage.getItem("agentOS:skipPermissions") === "true";

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
        skipPermissions,
        model: session.model,
      });

      const flagsStr = flags.join(" ");

      terminal.sendInput("\x02d");
      setTimeout(() => {
        terminal.sendInput("\x15");
        setTimeout(() => {
          terminal.sendCommand(`tmux attach -t ${sessionName} 2>/dev/null || tmux new -s ${sessionName} -c "${cwd}" "${provider.command} ${flagsStr}"`);
          attachSession(focusedPaneId, session.id, sessionName);
        }, 50);
      }, 100);
    }
  }, [getFocusedTerminal, focusedPaneId, attachSession, sessions]);

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
            setTimeout(() => {
              const cwd = data.session.working_directory?.replace('~', '$HOME') || '$HOME';
              const sessionName = `${provider.id}-${data.session.id}`;
              const skipPermissions = localStorage.getItem("agentOS:skipPermissions") === "true";
              const flags = provider.buildFlags({ skipPermissions });
              const flagsStr = flags.join(" ");
              terminal.sendCommand(`tmux new -s ${sessionName} -c "${cwd}" "${provider.command} ${flagsStr}"`);
              attachSession(focusedPaneId, data.session.id, sessionName);
            }, 50);
          }, 100);
        }
      }
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  // Handle clicking on existing tmux session
  const handleTmuxAttach = (sessionName: string) => {
    const terminal = getFocusedTerminal();
    if (terminal) {
      terminal.sendInput("\x02d");
      setTimeout(() => {
        terminal.sendInput("\x15");
        setTimeout(() => {
          terminal.sendCommand(`tmux attach -t ${sessionName}`);
          attachSession(focusedPaneId, "", sessionName);
        }, 50);
      }, 100);
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

  // Rename tmux session
  const handleRenameTmuxSession = async (oldName: string, newName: string) => {
    try {
      await fetch("/api/tmux/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName, newName }),
      });
      await fetchStatuses();
    } catch (error) {
      console.error("Failed to rename tmux session:", error);
    }
  };

  // Import external tmux session
  const handleImportTmuxSession = async (sessionName: string, claudeSessionId?: string) => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sessionName,
          claudeSessionId,
        }),
      });
      const data = await res.json();
      if (data.session) {
        await fetchSessions();
        // Rename tmux session to match our naming convention
        const newTmuxName = `claude-${data.session.id}`;
        await fetch("/api/tmux/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldName: sessionName, newName: newTmuxName }),
        });
        await fetchStatuses();
      }
    } catch (error) {
      console.error("Failed to import tmux session:", error);
    }
  };

  // Get active session from focused pane's active tab
  const activeSession = sessions.find(s => s.id === focusedActiveTab?.sessionId);

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* Sidebar */}
      <div
        className={`
        ${sidebarOpen ? "w-72" : "w-0"}
        flex-shrink-0 border-r border-border transition-all duration-200 overflow-hidden
      `}
      >
        <SessionList
          sessions={sessions}
          groups={groups}
          activeSessionId={focusedActiveTab?.sessionId || undefined}
          sessionStatuses={sessionStatuses}
          otherTmuxSessions={otherTmuxSessions}
          attachedTmux={focusedActiveTab?.attachedTmux}
          onSelect={(id) => {
            const session = sessions.find((s) => s.id === id);
            if (session) attachToSession(session);
          }}
          onRefresh={fetchSessions}
          onTmuxAttach={handleTmuxAttach}
          onToggleGroup={handleToggleGroup}
          onCreateGroup={handleCreateGroup}
          onDeleteGroup={handleDeleteGroup}
          onMoveSession={handleMoveSession}
          onForkSession={handleForkSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onRenameTmuxSession={handleRenameTmuxSession}
          onImportTmuxSession={handleImportTmuxSession}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeft className="w-4 h-4" />
              )}
            </Button>

            {activeSession && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{activeSession.name}</span>
                {focusedActiveTab?.attachedTmux && (
                  <span className="text-xs text-muted-foreground">
                    {focusedActiveTab.attachedTmux}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowNewSessionDialog(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New Session
            </Button>
          </div>
        </header>

        {/* New Session Dialog */}
        <NewSessionDialog
          open={showNewSessionDialog}
          groups={groups}
          onClose={() => setShowNewSessionDialog(false)}
          onCreated={(id) => {
            setShowNewSessionDialog(false);
            const session = sessions.find((s) => s.id === id);
            if (session) {
              attachToSession(session);
            } else {
              // Session was just created, refetch and then attach
              fetchSessions().then(() => {
                // We need to get the session from the API since it's new
                fetch(`/api/sessions/${id}`)
                  .then((res) => res.json())
                  .then((data) => {
                    if (data.session) attachToSession(data.session);
                  });
              });
            }
          }}
          onCreateGroup={async (name) => {
            await handleCreateGroup(name);
          }}
        />

        {/* Pane Layout */}
        <div className="flex-1 min-h-0 p-2">
          <PaneLayout
            renderPane={(paneId) => (
              <Pane
                key={paneId}
                paneId={paneId}
                sessions={sessions}
                onRegisterTerminal={registerTerminalRef}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <PaneProvider>
      <HomeContent />
    </PaneProvider>
  );
}
