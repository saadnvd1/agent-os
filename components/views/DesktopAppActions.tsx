"use client";

import { Command, PanelLeft, PanelLeftClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TasksButton } from "@/components/Tasks/TasksButton";
import { MessagesButton } from "@/components/Bus/MessagesButton";
import { DocsButton } from "@/components/LumifyHub/Docs/DocsButton";
import { NotificationSettings } from "@/components/NotificationSettings";
import type { ViewProps } from "./types";
import { paletteActions } from "@/stores/palette";

// Labels collapse to icons when the pane bar carrying these is narrow
// (a split), via the bar's container query.
export const BAR_LABEL = "hidden @5xl/bar:inline";

export function SidebarToggle({
  isPinned,
  togglePin,
}: {
  isPinned: boolean;
  togglePin: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            togglePin();
          }}
        >
          {isPinned ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isPinned ? "Unpin sidebar" : "Pin sidebar"}
      </TooltipContent>
    </Tooltip>
  );
}

type AppActionsProps = Pick<
  ViewProps,
  | "sessions"
  | "sessionStatuses"
  | "activeSession"
  | "showNotificationSettings"
  | "setShowNotificationSettings"
  | "setShowNewSessionDialog"
  | "notificationSettings"
  | "permissionGranted"
  | "updateSettings"
  | "requestPermission"
  | "attachToSession"
>;

export function DesktopAppActions({
  sessions,
  sessionStatuses,
  activeSession,
  showNotificationSettings,
  setShowNotificationSettings,
  setShowNewSessionDialog,
  notificationSettings,
  permissionGranted,
  updateSettings,
  requestPermission,
  attachToSession,
}: AppActionsProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Command palette"
            className="h-7 w-7"
            onClick={paletteActions.open}
          >
            <Command className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Command palette</p>
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
      <MessagesButton labelClassName={BAR_LABEL} />
      <TasksButton labelClassName={BAR_LABEL} />
      <DocsButton
        projectId={activeSession?.project_id}
        labelClassName={BAR_LABEL}
      />
      <Button
        size="sm"
        aria-label="New session"
        title="New session"
        className="ml-1 h-7 gap-1 px-2"
        onClick={() => setShowNewSessionDialog(true)}
      >
        <Plus className="h-4 w-4" />
        <span className="hidden @3xl/bar:inline">New session</span>
      </Button>
    </div>
  );
}
