"use client";

import { Bell, Volume2, VolumeX, AlertCircle } from "lucide-react";
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
import type { NotificationSettings as NotificationSettingsType } from "@/lib/notifications";

interface WaitingSession {
  id: string;
  name: string;
}

interface NotificationSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: NotificationSettingsType;
  permissionGranted: boolean;
  waitingSessions?: WaitingSession[];
  onUpdateSettings: (settings: Partial<NotificationSettingsType>) => void;
  onRequestPermission: () => Promise<boolean>;
  onSelectSession?: (id: string) => void;
}

export function NotificationSettings({
  open,
  onOpenChange,
  settings,
  permissionGranted,
  waitingSessions = [],
  onUpdateSettings,
  onRequestPermission,
  onSelectSession,
}: NotificationSettingsProps) {
  const waitingCount = waitingSessions.length;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative">
          <Bell className={cn("w-4 h-4", !settings.sound && "text-muted-foreground")} />
          {waitingCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 text-yellow-950 text-[10px] font-bold rounded-full flex items-center justify-center">
              {waitingCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/* Waiting sessions section */}
        {waitingCount > 0 && (
          <>
            <DropdownMenuLabel className="flex items-center gap-2 text-yellow-500 text-xs">
              <AlertCircle className="w-3 h-3" />
              Waiting for input
            </DropdownMenuLabel>
            {waitingSessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                onClick={() => {
                  onSelectSession?.(session.id);
                  onOpenChange(false);
                }}
                className="text-sm"
              >
                {session.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Sound toggle */}
        <DropdownMenuItem
          onClick={() => onUpdateSettings({ sound: !settings.sound })}
          className="flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            {settings.sound ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3 text-muted-foreground" />}
            Sound
          </span>
          <span
            className={cn(
              "w-8 h-4 rounded-full transition-colors relative",
              settings.sound ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform",
                settings.sound ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </span>
        </DropdownMenuItem>

        {/* Browser notifications - only show if not granted */}
        {!permissionGranted && (
          <DropdownMenuItem
            onClick={async () => {
              await onRequestPermission();
            }}
          >
            <Bell className="w-3 h-3 mr-2" />
            <span className="text-xs">Enable browser alerts</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
