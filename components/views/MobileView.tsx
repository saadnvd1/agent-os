'use client';

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
  groups,
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
  fetchSessions,
  fetchProjects,
  handleToggleGroup,
  handleCreateGroup,
  handleDeleteGroup,
  handleMoveSession,
  handleToggleProject,
  handleEditProject,
  handleDeleteProject,
  handleRenameProject,
  handleMoveSessionToProject,
  handleNewSessionInProject,
  handleForkSession,
  handleSummarize,
  summarizingSessionId,
  handleDeleteSession,
  handleRenameSession,
  handleCreatePR,
  devServers,
  handleStartDevServer,
  handleStopDevServer,
  handleRestartDevServer,
  handleRemoveDevServer,
  handleCreateDevServer,
  startDevServerProject,
  setStartDevServerProjectId,
  renderPane,
}: ViewProps) {
  return (
    <main className="h-dvh flex flex-col overflow-hidden bg-background">
      {/* Swipe sidebar */}
      <SwipeSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {/* Session list */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionList
              sessions={sessions}
              groups={groups}
              projects={projects}
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              sessionStatuses={sessionStatuses}
              summarizingSessionId={summarizingSessionId}
              devServers={devServers}
              onSelect={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
                setSidebarOpen(false);
              }}
              onRefresh={fetchSessions}
              onRefreshProjects={fetchProjects}
              onToggleGroup={handleToggleGroup}
              onCreateGroup={handleCreateGroup}
              onDeleteGroup={handleDeleteGroup}
              onMoveSession={handleMoveSession}
              onToggleProject={handleToggleProject}
              onEditProject={handleEditProject}
              onDeleteProject={handleDeleteProject}
              onRenameProject={handleRenameProject}
              onMoveSessionToProject={handleMoveSessionToProject}
              onNewSessionInProject={handleNewSessionInProject}
              onForkSession={handleForkSession}
              onSummarize={handleSummarize}
              onDeleteSession={handleDeleteSession}
              onRenameSession={handleRenameSession}
              onCreatePR={handleCreatePR}
              onStartDevServer={handleStartDevServer}
              onStopDevServer={handleStopDevServer}
              onRestartDevServer={handleRestartDevServer}
              onRemoveDevServer={handleRemoveDevServer}
            />
          </div>

          {/* Sidebar footer with theme toggle */}
          <div className="flex items-center justify-between px-4 py-2 mt-auto">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </SwipeSidebar>

      {/* Terminal fills the screen */}
      <div className="flex-1 min-h-0">
        <PaneLayout renderPane={renderPane} />
      </div>

      {/* Dialogs */}
      <NewSessionDialog
        open={showNewSessionDialog}
        projects={projects}
        selectedProjectId={newSessionProjectId ?? undefined}
        onClose={() => setShowNewSessionDialog(false)}
        onCreated={async (id) => {
          setShowNewSessionDialog(false);

          // Fetch the new session data
          await fetchSessions();
          const res = await fetch(`/api/sessions/${id}`);
          const data = await res.json();
          if (!data.session) return;

          // Small delay to ensure terminal is ready after state updates
          setTimeout(() => {
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
    </main>
  );
}
