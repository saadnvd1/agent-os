"use client";

import { DesktopSidebar } from "./DesktopSidebar";
import { DesktopAppActions, SidebarToggle } from "./DesktopAppActions";
import { PaneLayout } from "@/components/PaneLayout";
import { PaneBarSlotsProvider } from "@/components/Pane/PaneBarSlots";
import type { ViewProps } from "./types";
import { QuickSwitcher, StartServerDialog } from "./lazy";
import { fileOpenActions } from "@/stores/fileOpen";
import { useSidebarPinned } from "@/hooks/useSidebarPinned";

export function DesktopView({
  sessions,
  sessionStatuses,
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
  handleStartDevServer,
  handleCreateDevServer,
  startDevServerProject,
  setStartDevServerProjectId,
  renderPane,
}: ViewProps) {
  const { isPinned, togglePin } = useSidebarPinned();

  return (
    <div className="app-backdrop flex h-screen overflow-hidden">
      <DesktopSidebar
        isPinned={isPinned}
        togglePin={togglePin}
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

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Pane Layout - full height */}
        <div className="min-h-0 flex-1">
          <PaneBarSlotsProvider
            leading={
              <SidebarToggle isPinned={isPinned} togglePin={togglePin} />
            }
            trailing={
              <DesktopAppActions
                sessions={sessions}
                sessionStatuses={sessionStatuses}
                activeSession={activeSession}
                showNotificationSettings={showNotificationSettings}
                setShowNotificationSettings={setShowNotificationSettings}
                notificationSettings={notificationSettings}
                permissionGranted={permissionGranted}
                updateSettings={updateSettings}
                requestPermission={requestPermission}
                attachToSession={attachToSession}
              />
            }
          >
            <PaneLayout renderPane={renderPane} />
          </PaneBarSlotsProvider>
        </div>
      </div>

      {/* Dialogs */}
      <QuickSwitcher
        sessions={sessions}
        open={showQuickSwitcher}
        onOpenChange={setShowQuickSwitcher}
        currentSessionId={focusedActiveTab?.sessionId ?? undefined}
        activeSessionWorkingDir={activeSession?.working_directory ?? undefined}
        onSelectSession={(sessionId) => {
          const session = sessions.find((s) => s.id === sessionId);
          if (session) attachToSession(session);
        }}
        onSelectFile={(file, line) => {
          // Convert relative path to absolute by prepending working directory
          const absolutePath = activeSession?.working_directory
            ? `${activeSession.working_directory}/${file.replace(/^\.\//, "")}`
            : file;
          fileOpenActions.requestOpen(absolutePath, line);
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
