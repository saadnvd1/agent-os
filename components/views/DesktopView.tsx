'use client';

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { NotificationSettings } from "@/components/NotificationSettings";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeft, Plus, Copy, Check, Command, Sun, Moon } from "lucide-react";
import { PaneLayout } from "@/components/PaneLayout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";

export function DesktopView({
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
              sessions={sessions}
              groups={groups}
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              sessionStatuses={sessionStatuses}
              onSelect={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
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
                {focusedActiveTab?.attachedTmux && (
                  <span className="text-xs text-muted-foreground">
                    {focusedActiveTab.attachedTmux}
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
        groups={groups}
        onClose={() => setShowNewSessionDialog(false)}
        onCreated={(id) => {
          setShowNewSessionDialog(false);
          const session = sessions.find((s) => s.id === id);
          if (session) {
            attachToSession(session);
          } else {
            fetchSessions().then(() => {
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
    </div>
  );
}
