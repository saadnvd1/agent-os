"use client";

import { useState } from "react";
import { AlertCircle, Bell, Settings } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NotificationSettings } from "@/lib/notifications";
import { settingsUiActions } from "@/stores/settingsUi";

interface WaitingSession {
  id: string;
  name: string;
}

// The bell: sessions waiting for you, and the way to Settings > Notifications.
export function NotificationsMenu({
  settings,
  waitingSessions = [],
  onSelectSession,
}: {
  settings: NotificationSettings;
  waitingSessions?: WaitingSession[];
  onSelectSession?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const waitingCount = waitingSessions.length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Notifications"
          className="relative h-7 w-7"
        >
          <Bell
            className={cn(
              "h-4 w-4",
              !settings.sound && "text-muted-foreground"
            )}
          />
          {waitingCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-yellow-950">
              {waitingCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {waitingCount > 0 && (
          <>
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-yellow-500">
              <AlertCircle className="h-3 w-3" />
              Waiting for input
            </DropdownMenuLabel>
            {waitingSessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                onClick={() => onSelectSession?.(session.id)}
                className="text-sm"
              >
                {session.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => settingsUiActions.open("notifications")}
        >
          <Settings className="h-3 w-3" />
          Notification settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
