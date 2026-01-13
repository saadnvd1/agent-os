'use client';

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";
import { PaneLayout } from "@/components/PaneLayout";
import { SwipeSidebar } from "@/components/mobile/SwipeSidebar";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";

export function MobileView({
  sessions,
  groups,
  sessionStatuses,
  sidebarOpen,
  setSidebarOpen,
  focusedActiveTab,
  showNewSessionDialog,
  setShowNewSessionDialog,
  showQuickSwitcher,
  setShowQuickSwitcher,
  attachToSession,
  fetchSessions,
  handleToggleGroup,
  handleCreateGroup,
  handleDeleteGroup,
  handleMoveSession,
  handleForkSession,
  handleSummarize,
  summarizingSessionId,
  handleDeleteSession,
  handleRenameSession,
  handleCreatePR,
  renderPane,
}: ViewProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              sessionStatuses={sessionStatuses}
              onSelect={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
                setSidebarOpen(false);
              }}
              onRefresh={fetchSessions}
              onToggleGroup={handleToggleGroup}
              onCreateGroup={handleCreateGroup}
              onDeleteGroup={handleDeleteGroup}
              onMoveSession={handleMoveSession}
              onForkSession={handleForkSession}
              onSummarize={handleSummarize}
              summarizingSessionId={summarizingSessionId}
              onDeleteSession={handleDeleteSession}
              onRenameSession={handleRenameSession}
              onCreatePR={handleCreatePR}
            />
          </div>

          {/* Sidebar footer with theme toggle */}
          <div className="flex items-center justify-between px-4 py-2 mt-auto">
            <span className="text-xs text-muted-foreground">Theme</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {mounted && (theme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              ))}
            </Button>
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
        groups={groups}
        onClose={() => setShowNewSessionDialog(false)}
        onCreated={(id) => {
          setShowNewSessionDialog(false);
          fetchSessions().then(() => {
            fetch(`/api/sessions/${id}`)
              .then((res) => res.json())
              .then((data) => {
                if (data.session) attachToSession(data.session);
              });
          });
        }}
        onCreateGroup={async (name) => {
          await handleCreateGroup(name);
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
    </main>
  );
}
