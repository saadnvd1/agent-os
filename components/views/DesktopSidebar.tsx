"use client";

import { useRef, useState } from "react";
import { SessionList } from "@/components/SessionList";
import { SidebarFooter } from "@/components/SidebarFooter";
import { cn } from "@/lib/utils";

// Delay before an unpinned, hover-revealed sidebar collapses again
const COLLAPSE_DELAY_MS = 300;

interface DesktopSidebarProps {
  isPinned: boolean;
  togglePin: () => void;
  activeSessionId?: string;
  sessionStatuses: React.ComponentProps<typeof SessionList>["sessionStatuses"];
  onSelect: (sessionId: string) => void;
  onOpenInTab: (sessionId: string) => void;
  onNewSessionInProject: (projectId: string) => void;
  onOpenTerminal: (projectId: string) => void;
  onStartDevServer: (projectId: string) => void;
  onCreateDevServer: React.ComponentProps<
    typeof SessionList
  >["onCreateDevServer"];
}

export function DesktopSidebar({
  isPinned,
  togglePin,
  activeSessionId,
  sessionStatuses,
  onSelect,
  onOpenInTab,
  onNewSessionInProject,
  onOpenTerminal,
  onStartDevServer,
  onCreateDevServer,
}: DesktopSidebarProps) {
  // When unpinned, the sidebar floats and reveals on hover near the left edge
  const [revealed, setRevealed] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCollapse = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };
  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimer.current = setTimeout(
      () => setRevealed(false),
      COLLAPSE_DELAY_MS
    );
  };
  const revealNow = () => {
    cancelCollapse();
    setRevealed(true);
  };

  const content = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <SessionList
          activeSessionId={activeSessionId}
          sessionStatuses={sessionStatuses}
          onSelect={onSelect}
          onOpenInTab={onOpenInTab}
          onNewSessionInProject={onNewSessionInProject}
          onOpenTerminal={onOpenTerminal}
          onStartDevServer={onStartDevServer}
          onCreateDevServer={onCreateDevServer}
          pinControls={{ isPinned, onTogglePin: togglePin }}
        />
      </div>
      <SidebarFooter />
    </div>
  );

  if (isPinned) {
    return (
      <div className="bg-sidebar-background w-60 flex-shrink-0 overflow-hidden shadow-xl shadow-black/10 transition-all duration-200 dark:shadow-black/30">
        {content}
      </div>
    );
  }

  return (
    <>
      {/* Hover trigger strip on the left edge reveals the floating sidebar */}
      <div
        className="fixed top-0 left-0 z-30 h-full w-2"
        onMouseEnter={revealNow}
      />
      <div
        onMouseEnter={revealNow}
        onMouseLeave={scheduleCollapse}
        className={cn(
          "bg-sidebar-background fixed top-0 left-0 z-40 h-full w-60 overflow-hidden shadow-2xl transition-transform duration-200 ease-out dark:shadow-black/50",
          revealed ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {content}
      </div>
    </>
  );
}
