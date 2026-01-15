"use client";

import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PaneLayout } from "@/components/PaneLayout";
import { SwipeSidebar } from "@/components/mobile/SwipeSidebar";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";

export function MobileView({
  sessions,
  projects,
  sessionStatuses,
  sidebarOpen,
  setSidebarOpen,
  focusedActiveTab,
  showNewSessionDialog,
  setShowNewSessionDialog,
  newSessionProjectId,
  showQuickSwitcher,
  setShowQuickSwitcher,
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
    <main className="bg-background flex h-dvh flex-col overflow-hidden">
      {/* Swipe sidebar */}
      <SwipeSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {/* Session list */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <SessionList
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              sessionStatuses={sessionStatuses}
              onSelect={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
                setSidebarOpen(false);
              }}
              onOpenInTab={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) openSessionInNewTab(session);
                setSidebarOpen(false);
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
      </SwipeSidebar>

      {/* Terminal fills the screen */}
      <div className="min-h-0 w-full flex-1">
        <PaneLayout renderPane={renderPane} />
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
    </main>
  );
}
