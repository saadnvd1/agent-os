"use client";

import { type Session } from "@/lib/db";
import { Terminal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onNewSession: () => void;
}

/**
 * Mobile bottom navigation for session switching
 * Shows up to 4 recent sessions + new session button
 */
export function BottomNav({
  sessions,
  activeSessionId,
  onSessionClick,
  onNewSession,
}: BottomNavProps) {
  // Show max 4 most recent sessions
  const recentSessions = sessions.slice(0, 4);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden">
      <div className="flex items-center justify-around h-16 px-2">
        {recentSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSessionClick(session.id)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors flex-1 max-w-[80px]",
              "min-h-[44px] min-w-[44px]", // Touch target size
              activeSessionId === session.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Terminal className="w-5 h-5 flex-shrink-0" />
            <span className="text-xs truncate w-full text-center">
              {session.name}
            </span>
          </button>
        ))}

        {/* New Session Button */}
        <button
          onClick={onNewSession}
          className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors flex-1 max-w-[80px] text-muted-foreground hover:bg-accent hover:text-foreground min-h-[44px] min-w-[44px]"
          aria-label="New session"
        >
          <Plus className="w-5 h-5" />
          <span className="text-xs">New</span>
        </button>
      </div>

      {/* Safe area spacer for devices with bottom notch */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
