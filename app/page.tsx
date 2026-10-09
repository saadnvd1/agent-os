"use client";

import { toast } from "sonner";

import { subscribe } from "valtio";
import { viewSwitchStore, viewSwitchActions } from "@/stores/viewSwitch";
import { useOpenSession } from "@/hooks/useOpenSession";
import { tmuxAttachStore, tmuxAttachActions } from "@/stores/tmuxAttach";
import type { AttachSpec } from "@/lib/hosts/attach";
import { memo, useState, useEffect, useCallback, useRef } from "react";

// Debug log buffer - persists even if console is closed
const debugLogs: string[] = [];
const MAX_DEBUG_LOGS = 100;

function debugLog(message: string) {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  const entry = `[${timestamp}] ${message}`;
  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  console.log(`[AgentOS] ${message}`);
}

// Expose to window for debugging
if (typeof window !== "undefined") {
  (window as unknown as { agentOSLogs: () => void }).agentOSLogs = () => {
    console.log("=== AgentOS Debug Logs ===");
    debugLogs.forEach((log) => console.log(log));
    console.log("=== End Logs ===");
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
import { CLAUDE_STATUS_SETTINGS_FLAG } from "@/lib/program-status/claude-flag";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";
import { getPendingPrompt, clearPendingPrompt } from "@/stores/initialPrompt";
import { useDraftKeys } from "@/hooks/useDraftKeys";
import { useDraftRequests } from "@/hooks/useDraftRequests";
import { newDraft } from "@/stores/drafts";
import { useOpenOrchestrator } from "@/hooks/useOpenOrchestrator";
import { paletteActions, paletteUi } from "@/stores/palette";
import { useAppCommands } from "@/components/CommandPalette/useAppCommands";
import { useMoveCommands } from "@/components/Tasks/useMoveCommands";
import dynamic from "next/dynamic";
import { chatMetaActions } from "@/stores/chatMeta";
import { useDemoMode } from "@/data/demo";

// The app's dialogs open from their stores, so none is needed for the first
// paint: their code loads right after it.
const TasksDialog = dynamic(
  () => import("@/components/Tasks/TasksDialog").then((m) => m.TasksDialog),
  { ssr: false }
);
const AddProjectDialog = dynamic(
  () =>
    import("@/components/Projects/AddProject/AddProjectDialog").then(
      (m) => m.AddProjectDialog
    ),
  { ssr: false }
);
const SchedulesDialog = dynamic(
  () =>
    import("@/components/Schedules/SchedulesDialog").then(
      (m) => m.SchedulesDialog
    ),
  { ssr: false }
);
const PhoneNotifyDialog = dynamic(
  () =>
    import("@/components/PhoneNotify/PhoneNotifyDialog").then(
      (m) => m.PhoneNotifyDialog
    ),
  { ssr: false }
);
const MessagesDialog = dynamic(
  () => import("@/components/Bus/MessagesDialog").then((m) => m.MessagesDialog),
  { ssr: false }
);
const DevicesDialog = dynamic(
  () =>
    import("@/components/Devices/DevicesDialog").then((m) => m.DevicesDialog),
  { ssr: false }
);
const ArchivedDialog = dynamic(
  () =>
    import("@/components/Archived/ArchivedDialog").then(
      (m) => m.ArchivedDialog
    ),
  { ssr: false }
);
const CleanupDialog = dynamic(
  () =>
    import("@/components/Archived/CleanupDialog").then((m) => m.CleanupDialog),
  { ssr: false }
);
const LumifyHubDialogs = dynamic(
  () =>
    import("@/components/LumifyHub/LumifyHubDialogs").then(
      (m) => m.LumifyHubDialogs
    ),
  { ssr: false }
);
const UsageDialog = dynamic(
  () => import("@/components/Usage/UsageDialog").then((m) => m.UsageDialog),
  { ssr: false }
);
const MoveDialog = dynamic(
  () => import("@/components/Tasks/MoveDialog").then((m) => m.MoveDialog),
  { ssr: false }
);
const CommandPalette = dynamic(
  () =>
    import("@/components/CommandPalette/CommandPalette").then(
      (m) => m.CommandPalette
    ),
  { ssr: false }
);

// Held apart from HomeContent, which re-renders on every status push.
const AppDialogs = memo(function AppDialogs() {
  return (
    <>
      <TasksDialog />
      <SchedulesDialog />
      <PhoneNotifyDialog />
      <AddProjectDialog />
      <MessagesDialog />
      <DevicesDialog />
      <ArchivedDialog />
      <CleanupDialog />
      <LumifyHubDialogs />
      <UsageDialog />
      <MoveDialog />
      <CommandPalette />
    </>
  );
});

function HomeContent() {
  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] =
    useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map());

  // Pane context
  const { focusedPaneId, attachSession, getActiveTab, addTab, openDraft } =
    usePanes();
  const focusedActiveTab = getActiveTab(focusedPaneId);
  const { isMobile, isHydrated } = useViewport();
  const demo = useDemoMode();

  // Data hooks
  const { sessions, fetchSessions } = useSessions();
  const { projects } = useProjects();
  const {
    startDevServerProjectId,
    setStartDevServerProjectId,
    startDevServer,
    createDevServer,
  } = useDevServersManager();

  // Helper to get init script command from API
  const getInitScriptCommand = useCallback(
    async (agentCommand: string): Promise<string> => {
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
    },
    []
  );

  // Set CSS variable for viewport height (handles mobile keyboard)
  useViewportHeight();

  // Terminal ref management
  const registerTerminalRef = useCallback(
    (paneId: string, tabId: string, ref: TerminalHandle | null) => {
      const key = `${paneId}:${tabId}`;
      if (ref) {
        terminalRefs.current.set(key, ref);
        debugLog(
          `Terminal registered: ${key}, total refs: ${terminalRefs.current.size}`
        );
      } else {
        terminalRefs.current.delete(key);
        debugLog(
          `Terminal unregistered: ${key}, total refs: ${terminalRefs.current.size}`
        );
      }
    },
    []
  );

  // Get terminal for a pane, with fallback to first available
  const getTerminalWithFallback = useCallback(():
    | { terminal: TerminalHandle; paneId: string; tabId: string }
    | undefined => {
    debugLog(
      `getTerminalWithFallback called, total refs: ${terminalRefs.current.size}, focusedPaneId: ${focusedPaneId}`
    );

    // Try focused pane first
    const activeTab = getActiveTab(focusedPaneId);
    debugLog(`activeTab for focused pane: ${activeTab?.id || "null"}`);

    if (activeTab) {
      const key = `${focusedPaneId}:${activeTab.id}`;
      const terminal = terminalRefs.current.get(key);
      debugLog(
        `Looking for terminal at key "${key}": ${terminal ? "found" : "not found"}`
      );
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

    debugLog(
      `NO TERMINAL FOUND. Available keys: ${Array.from(terminalRefs.current.keys()).join(", ") || "none"}`
    );
    return undefined;
  }, [focusedPaneId, getActiveTab]);

  // Build tmux command for a session
  const buildSessionCommand = useCallback(
    async (session: Session): Promise<AttachSpec> => {
      const provider = getProvider(session.agent_type || "claude");
      const sessionName = session.tmux_name || `${provider.id}-${session.id}`;
      const cwd = session.working_directory || "~";
      const hostId = session.host_id;
      const sessionId = session.id;
      const isLocal = !hostId || hostId === "local";

      // Shell sessions just open a terminal - no agent command
      if (provider.id === "shell") {
        return { sessionName, cwd, hostId, sessionId };
      }

      // TODO: Add explicit "Enable Orchestration" toggle that creates .mcp.json
      // for conductor sessions. Removed auto-creation because it pollutes projects
      // with .mcp.json files that aren't in their .gitignore.
      // See: /api/sessions/[id]/mcp-config, lib/mcp-config.ts

      // Get parent session ID for forking
      let parentSessionId: string | null = null;
      if (!session.claude_session_id && session.parent_session_id) {
        const parentSession = sessions.find(
          (s) => s.id === session.parent_session_id
        );
        parentSessionId = parentSession?.claude_session_id || null;
      }

      // Check for pending initial prompt
      const initialPrompt = getPendingPrompt(session.id);
      if (initialPrompt) {
        clearPendingPrompt(session.id);
      }

      const flags = provider.buildFlags({
        sessionId: session.claude_session_id,
        parentSessionId,
        autoApprove: session.auto_approve,
        model: session.model,
        initialPrompt: initialPrompt || undefined,
      });
      const flagsStr = flags.join(" ");

      // Local Claude sessions learn about the agent bus (`aos`), and report
      // their state to the sidebar (OSC 7501).
      const busBrief =
        isLocal && provider.id === "claude"
          ? ` --append-system-prompt-file "$HOME/.agent-os/bus-brief.md" ${CLAUDE_STATUS_SETTINGS_FLAG}`
          : "";
      const agentCmd = `${provider.command} ${flagsStr}${busBrief}`;
      // The init script is a file on this machine, so remote sessions run the
      // agent directly and drop to a shell when it exits.
      const command =
        hostId && hostId !== "local"
          ? `export PATH="$HOME/.local/bin:$PATH"; ${agentCmd}; exec "$SHELL" -l`
          : await getInitScriptCommand(agentCmd);

      return { sessionName, cwd, command, hostId, sessionId };
    },
    [sessions, getInitScriptCommand]
  );

  // Attach a session to a terminal
  const runSessionInTerminal = useCallback(
    (
      terminal: TerminalHandle,
      paneId: string,
      session: Session,
      spec: AttachSpec
    ) => {
      terminal.attach(spec);
      attachSession(paneId, session.id, spec.sessionName, spec.hostId);
      terminal.focus();
    },
    [attachSession]
  );

  // Attach session to terminal
  const attachToSession = useCallback(
    async (session: Session) => {
      // A chat tab, or a tab whose terminal isn't mounted yet: point the tab
      // at the session and its terminal attaches as it connects
      // (onAttachSession), resuming the agent.
      const activeTab = getActiveTab(focusedPaneId);
      const terminalInfo =
        session.view === "chat" || !activeTab
          ? undefined
          : terminalRefs.current.get(`${focusedPaneId}:${activeTab.id}`);
      if (!terminalInfo) {
        attachSession(focusedPaneId, session.id, session.tmux_name);
        return;
      }

      const spec = await buildSessionCommand(session);
      runSessionInTerminal(terminalInfo, focusedPaneId, session, spec);
    },
    [
      getActiveTab,
      buildSessionCommand,
      runSessionInTerminal,
      attachSession,
      focusedPaneId,
    ]
  );

  // Switching a session between chat and terminal hands the same conversation
  // over: the server stops whichever side was running, and a terminal resumes
  // the agent's own session once the tab's terminal is up.
  useEffect(
    () =>
      subscribe(viewSwitchStore, async () => {
        const request = viewSwitchStore.request;
        if (!request) return;
        viewSwitchActions.clear();
        const res = await fetch(`/api/sessions/${request.sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ view: request.view }),
        });
        // The tab's terminal mounts once the session reads as terminal, and
        // attaches through onAttachSession, resuming the conversation.
        if (res.ok) await fetchSessions();
        else
          toast.error(
            ((await res.json().catch(() => null)) as { error?: string } | null)
              ?.error ?? "Couldn't switch view"
          );
      }),
    [fetchSessions]
  );

  // How a session's terminal connects: its full launch command, which
  // attaches to a running tmux session or starts it (resuming the agent).
  const attachSessionTerminal = useCallback(
    async (terminal: TerminalHandle, session: Session) => {
      if (session.view === "chat") return;
      terminal.attach(await buildSessionCommand(session));
    },
    [buildSessionCommand]
  );

  // Attach a tmux session agent-os didn't create (discovered on any machine)
  // Subscribed rather than read in render, so handling a request (and closing
  // the mobile sidebar, as selecting any session does) happens in a callback.
  useEffect(
    () =>
      subscribe(tmuxAttachStore, () => {
        const request = tmuxAttachStore.request;
        if (!request) return;
        tmuxAttachActions.clear();
        if (isMobile) setSidebarOpen(false);
        const terminalInfo = getTerminalWithFallback();
        if (!terminalInfo) return;
        const { sessionName, hostId } = request;
        terminalInfo.terminal.attach({ sessionName, hostId, attachOnly: true });
        attachSession(terminalInfo.paneId, null, sessionName, hostId);
        terminalInfo.terminal.focus();
      }),
    [getTerminalWithFallback, attachSession, isMobile]
  );

  // Open session in new tab
  const openSessionInNewTab = useCallback(
    (session: Session) => {
      const existingKeys = new Set(terminalRefs.current.keys());
      addTab(focusedPaneId);
      if (session.view === "chat") {
        attachSession(focusedPaneId, session.id, session.tmux_name);
        return;
      }

      let attempts = 0;
      const maxAttempts = 20;

      const waitForNewTerminal = () => {
        attempts++;

        for (const key of terminalRefs.current.keys()) {
          if (!existingKeys.has(key) && key.startsWith(`${focusedPaneId}:`)) {
            const terminal = terminalRefs.current.get(key);
            if (terminal) {
              buildSessionCommand(session).then((spec) => {
                runSessionInTerminal(terminal, focusedPaneId, session, spec);
              });
              return;
            }
          }
        }

        if (attempts < maxAttempts) {
          setTimeout(waitForNewTerminal, 50);
        } else {
          debugLog(`Failed to find new terminal after ${maxAttempts} attempts`);
        }
      };

      setTimeout(waitForNewTerminal, 50);
    },
    [
      addTab,
      focusedPaneId,
      buildSessionCommand,
      runSessionInTerminal,
      attachSession,
    ]
  );

  // Notification click handler
  const handleNotificationClick = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        attachToSession(session);
      }
    },
    [sessions, attachToSession]
  );

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

  // Set initial sidebar state based on viewport (only after hydration)
  useEffect(() => {
    if (isHydrated && !isMobile) setSidebarOpen(true);
  }, [isMobile, isHydrated]);

  // Cmd+K: the command palette, which searches sessions too.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteUi.open) paletteActions.setOpen(false);
        else paletteActions.open();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Session selection handler
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      debugLog(`handleSelectSession called for: ${sessionId}`);
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        debugLog(`Found session: ${session.name}, calling attachToSession`);
        attachToSession(session);
      } else {
        debugLog(
          `Session not found in sessions array (length: ${sessions.length})`
        );
      }
    },
    [sessions, attachToSession]
  );

  // Pane renderer
  const renderPane = useCallback(
    (paneId: string) => (
      <Pane
        key={paneId}
        paneId={paneId}
        sessions={sessions}
        projects={projects}
        onRegisterTerminal={registerTerminalRef}
        onMenuClick={isMobile ? () => setSidebarOpen(true) : undefined}
        onSelectSession={handleSelectSession}
        onAttachSession={attachSessionTerminal}
      />
    ),
    [
      sessions,
      projects,
      registerTerminalRef,
      isMobile,
      handleSelectSession,
      attachSessionTerminal,
    ]
  );

  // A draft in the project, or the current one; sent, it becomes a session.
  const handleNewSessionInProject = useCallback((projectId: string) => {
    newDraft(projectId ? { kind: "project", projectId } : { kind: "current" });
  }, []);
  useDraftKeys();
  useDraftRequests({
    sessions,
    projects,
    viewing: {
      session: sessions.find((s) => s.id === focusedActiveTab?.sessionId),
      draftId: focusedActiveTab?.draftId,
    },
    show: (draftId) => {
      openDraft(focusedPaneId, draftId);
      if (isMobile) setSidebarOpen(false);
    },
  });

  // Opens a session made elsewhere (an orchestrator, a schedule's run).
  const handleSessionCreated = useCallback(
    async (sessionId: string) => {
      await fetchSessions();

      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (!data.session) return;

      setTimeout(() => attachToSession(data.session), 100);
    },
    [fetchSessions, attachToSession]
  );

  // A workspace's orchestrator row opens its chat, made on first open.
  const handleOrchestratorOpened = useCallback(
    (sessionId: string) => {
      if (isMobile) setSidebarOpen(false);
      void handleSessionCreated(sessionId);
    },
    [isMobile, handleSessionCreated]
  );
  useOpenOrchestrator(handleOrchestratorOpened);
  // A session opened from elsewhere (a schedule's run history).
  useOpenSession(handleOrchestratorOpened);

  // Open terminal in project handler (shell session, not AI agent)
  const handleOpenTerminal = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      // A demo runs no shell: a new tab shows its notice.
      if (demo) return addTab(focusedPaneId);

      // Create a shell session with the project's working directory
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${project.name} Terminal`,
          workingDirectory: project.working_directory || "~",
          agentType: "shell",
          projectId,
        }),
      });

      const data = await res.json();
      if (!data.session) return;

      await fetchSessions();

      // Small delay to ensure state updates, then attach
      setTimeout(() => {
        attachToSession(data.session);
      }, 100);
    },
    [projects, fetchSessions, attachToSession, demo, addTab, focusedPaneId]
  );

  // Active session and dev server project
  const activeSession = sessions.find(
    (s) => s.id === focusedActiveTab?.sessionId
  );
  useEffect(() => {
    chatMetaActions.setActive(focusedActiveTab?.sessionId ?? null);
  }, [focusedActiveTab?.sessionId]);

  useAppCommands({
    sessions,
    onSelectSession: attachToSession,
    onSearchCode: () => setShowQuickSwitcher(true),
    // Its dialog lives in the desktop bar.
    onNotificationSettings: isMobile
      ? undefined
      : () => setShowNotificationSettings(true),
  });
  useMoveCommands(activeSession);

  const startDevServerProject = startDevServerProjectId
    ? (projects.find((p) => p.id === startDevServerProjectId) ?? null)
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
    handleNewSessionInProject,
    handleOpenTerminal,
    handleStartDevServer: startDevServer,
    handleCreateDevServer: createDevServer,
    startDevServerProject,
    setStartDevServerProjectId,
    renderPane,
  };

  return (
    <>
      {isMobile ? (
        <MobileView {...viewProps} />
      ) : (
        <DesktopView {...viewProps} />
      )}
      <AppDialogs />
    </>
  );
}

export default function Home() {
  return (
    <PaneProvider>
      <HomeContent />
    </PaneProvider>
  );
}
