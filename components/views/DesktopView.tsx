'use client';

import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { NotificationSettings } from "@/components/NotificationSettings";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeft, Plus, Copy, Check, Command } from "lucide-react";
import { PaneLayout } from "@/components/PaneLayout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";

export function DesktopView({
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
  setShowNewSessionDialog,
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
  handleStartDevServer,
  handleCreateDevServer,
  startDevServerProject,
  setStartDevServerProjectId,
  renderPane,
}: ViewProps) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <div
        className={`
          ${sidebarOpen ? "w-72" : "w-0"} flex-shrink-0 transition-all duration-200 overflow-hidden
          shadow-xl shadow-black/10 dark:shadow-black/30 bg-sidebar-background
        `}
      >
        <div className="flex h-full flex-col">
          {/* Session list */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionList
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              sessionStatuses={sessionStatuses}
              onSelect={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
              }}
              onOpenInTab={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) openSessionInNewTab(session);
              }}
              onNewSessionInProject={handleNewSessionInProject}
              onStartDevServer={handleStartDevServer}
              onCreateDevServer={handleCreateDevServer}
            />
          </div>

          {/* Sidebar footer with theme toggle */}
          <div className="flex items-center justify-between px-4 py-2 mt-auto">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2">
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
                {activeSession.tmux_name && (
                  <span className="text-xs text-muted-foreground">
                    {activeSession.tmux_name}
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6"
                      onClick={() => {
                        navigator.clipboard.writeText(activeSession.id);
                        setCopiedSessionId(true);
                        setTimeout(() => setCopiedSessionId(false), 2000);
                      }}
                    >
                      {copiedSessionId ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copy session ID for orchestration</p>
                    <p className="text-xs text-muted-foreground font-mono">{activeSession.id.slice(0, 8)}...</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowQuickSwitcher(true)}
                >
                  <Command className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Quick switch</p>
                <p className="text-xs text-muted-foreground">⌘K</p>
              </TooltipContent>
            </Tooltip>
            <NotificationSettings
              open={showNotificationSettings}
              onOpenChange={setShowNotificationSettings}
              settings={notificationSettings}
              permissionGranted={permissionGranted}
              waitingSessions={sessions
                .filter(s => sessionStatuses[s.id]?.status === "waiting")
                .map(s => ({ id: s.id, name: s.name }))}
              onUpdateSettings={updateSettings}
              onRequestPermission={requestPermission}
              onSelectSession={(id) => {
                const session = sessions.find(s => s.id === id);
                if (session) attachToSession(session);
              }}
            />
            <Button size="sm" onClick={() => setShowNewSessionDialog(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New Session
            </Button>
          </div>
        </header>

        {/* Pane Layout - full height */}
        <div className="flex-1 min-h-0">
          <PaneLayout renderPane={renderPane} />
        </div>
      </div>

      {/* Dialogs */}
      <NewSessionDialog
        open={showNewSessionDialog}
        projects={projects}
        selectedProjectId={newSessionProjectId ?? undefined}
        onClose={() => setShowNewSessionDialog(false)}
        onCreated={async (id) => {
          console.log(`[AgentOS] onCreated called for session: ${id}`);
          setShowNewSessionDialog(false);

          // Fetch the new session data
          console.log(`[AgentOS] Fetching sessions...`);
          await fetchSessions();
          console.log(`[AgentOS] Sessions fetched, now fetching session data...`);
          const res = await fetch(`/api/sessions/${id}`);
          const data = await res.json();
          if (!data.session) {
            console.log(`[AgentOS] No session data returned for id: ${id}`);
            return;
          }
          console.log(`[AgentOS] Session data fetched: ${data.session.name}`);

          // Small delay to ensure terminal is ready after state updates
          console.log(`[AgentOS] Starting 100ms delay before attachToSession...`);
          setTimeout(() => {
            console.log(`[AgentOS] Delay complete, calling attachToSession...`);
            attachToSession(data.session);
          }, 100);
        }}
        onCreateProject={async (name, workingDirectory, agentType) => {
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, workingDirectory, agentType }),
          });
          const data = await res.json();
          if (data.project) {
            await fetchProjects();
            return data.project.id;
          }
          return null;
        }}
      />
      <QuickSwitcher
        sessions={sessions}
        open={showQuickSwitcher}
        onOpenChange={setShowQuickSwitcher}
        currentSessionId={focusedActiveTab?.sessionId ?? undefined}
        onSelectSession={(sessionId) => {
          const session = sessions.find((s) => s.id === sessionId);
          if (session) attachToSession(session);
        }}
      />
      {startDevServerProject && (
        <StartServerDialog
          project={startDevServerProject}
          projectDevServers={startDevServerProject.devServers}
          onStart={handleCreateDevServer}
          onClose={() => setStartDevServerProjectId(null)}
        />
      )}
    </div>
  );
}
