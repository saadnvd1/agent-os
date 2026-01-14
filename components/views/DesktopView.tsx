"use client";

import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { NotificationSettings } from "@/components/NotificationSettings";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  Copy,
  Check,
  Command,
} from "lucide-react";
import { PaneLayout } from "@/components/PaneLayout";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  handleNewSessionInProject,
  handleOpenTerminal,
  handleSessionCreated,
  handleCreateProject,
  handleStartDevServer,
  handleCreateDevServer,
  startDevServerProject,
  setStartDevServerProjectId,
  renderPane,
}: ViewProps) {
  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      {/* Desktop Sidebar */}
      <div
        className={` ${sidebarOpen ? "w-72" : "w-0"} bg-sidebar-background flex-shrink-0 overflow-hidden shadow-xl shadow-black/10 transition-all duration-200 dark:shadow-black/30`}
      >
        <div className="flex h-full flex-col">
          {/* Session list */}
          <div className="min-h-0 flex-1 overflow-hidden">
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
              onOpenTerminal={handleOpenTerminal}
              onStartDevServer={handleStartDevServer}
              onCreateDevServer={handleCreateDevServer}
            />
          </div>

          {/* Sidebar footer with theme toggle */}
          <div className="mt-auto flex items-center justify-between px-4 py-2">
            <span className="text-muted-foreground text-xs">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>

            {activeSession && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{activeSession.name}</span>
                {activeSession.tmux_name && (
                  <span className="text-muted-foreground text-xs">
                    {activeSession.tmux_name}
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard) {
                            await navigator.clipboard.writeText(
                              activeSession.id
                            );
                          } else {
                            // Fallback for non-HTTPS contexts
                            const textarea = document.createElement("textarea");
                            textarea.value = activeSession.id;
                            textarea.style.position = "fixed";
                            textarea.style.opacity = "0";
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand("copy");
                            document.body.removeChild(textarea);
                          }
                          setCopiedSessionId(true);
                          setTimeout(() => setCopiedSessionId(false), 2000);
                        } catch {
                          console.error("Failed to copy to clipboard");
                        }
                      }}
                    >
                      {copiedSessionId ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copy session ID for orchestration</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {activeSession.id.slice(0, 8)}...
                    </p>
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
                  <Command className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Quick switch</p>
                <p className="text-muted-foreground text-xs">⌘K</p>
              </TooltipContent>
            </Tooltip>
            <NotificationSettings
              open={showNotificationSettings}
              onOpenChange={setShowNotificationSettings}
              settings={notificationSettings}
              permissionGranted={permissionGranted}
              waitingSessions={sessions
                .filter((s) => sessionStatuses[s.id]?.status === "waiting")
                .map((s) => ({ id: s.id, name: s.name }))}
              onUpdateSettings={updateSettings}
              onRequestPermission={requestPermission}
              onSelectSession={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
              }}
            />
            <Button size="sm" onClick={() => setShowNewSessionDialog(true)}>
              <Plus className="mr-1 h-4 w-4" />
              New Session
            </Button>
          </div>
        </header>

        {/* Pane Layout - full height */}
        <div className="min-h-0 flex-1">
          <PaneLayout renderPane={renderPane} />
        </div>
      </div>

      {/* Dialogs */}
      <NewSessionDialog
        open={showNewSessionDialog}
        projects={projects}
        selectedProjectId={newSessionProjectId ?? undefined}
        onClose={() => setShowNewSessionDialog(false)}
        onCreated={handleSessionCreated}
        onCreateProject={handleCreateProject}
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
