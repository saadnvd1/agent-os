"use client";

import { SessionPrStage } from "@/components/PrStageBadge";
import { ViewSwitch } from "@/components/Chat/ViewSwitch";
import { paletteActions } from "@/stores/palette";
import { newDraft } from "@/stores/drafts";
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Circle,
  Menu,
  Plus,
  Search,
  Star,
  Share2,
  TextSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAwayQuery } from "@/data/away";
import { awayUntil } from "@/components/Away/time";
import type { Session, Project } from "@/lib/db";
import { HostBadge } from "@/components/Hosts/HostBadge";
import { bookmarksUiActions } from "@/stores/bookmarksUi";
import { shareUiActions } from "@/stores/shareUi";
import { MoveMenuItems } from "@/components/Tasks/MoveMenuItems";
import { ChatBookmarksButton } from "@/components/Bookmarks/ChatBookmarksButton";
import type { ViewMode } from "@/contexts/PaneContext";
import { MobileViewPicker } from "./MobileViewPicker";

interface MobileTabBarProps {
  session: Session | null | undefined;
  // The tab shows a draft: a session not sent yet.
  drafting?: boolean;
  sessions: Session[];
  projects: Project[];
  viewMode: ViewMode;
  isConductor: boolean;
  hasLog?: boolean;
  workerCount: number;
  onMenuClick?: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSelectSession?: (sessionId: string) => void;
  // Opens find in the chat on show (there's no ⌘F on a phone).
  onFind?: () => void;
  // The chat on show, for its bookmarks.
  bookmarksSessionId?: string | null;
}

export function MobileTabBar({
  session,
  drafting,
  sessions,
  projects,
  viewMode,
  isConductor,
  hasLog,
  workerCount,
  onMenuClick,
  onViewModeChange,
  onSelectSession,
  onFind,
  bookmarksSessionId,
}: MobileTabBarProps) {
  const away = useAwayQuery().data?.away ?? null;
  // Find current session index and calculate prev/next
  const currentIndex = session
    ? sessions.findIndex((s) => s.id === session.id)
    : -1;

  // Get project name for current session
  const projectName = session?.project_id
    ? projects.find((p) => p.id === session.project_id)?.name
    : null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < sessions.length - 1;

  // Debounce to prevent rapid clicking causing command interference
  const [isNavigating, setIsNavigating] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleNavigate = useCallback(
    (sessionId: string) => {
      if (isNavigating || !onSelectSession) return;

      setIsNavigating(true);
      onSelectSession(sessionId);

      // Allow next navigation after delay (tmux commands need time)
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setIsNavigating(false);
      }, 500);
    },
    [isNavigating, onSelectSession]
  );

  const handlePrev = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasPrev && !isNavigating) {
      handleNavigate(sessions[currentIndex - 1].id);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasNext && !isNavigating) {
      handleNavigate(sessions[currentIndex + 1].id);
    }
  };

  const isLocalSession = !session?.host_id || session.host_id === "local";

  return (
    <div
      className="bg-muted flex items-center gap-1.5 px-2 py-1.5"
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/* Menu button */}
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          aria-label={
            away ? `Menu (Away ${awayUntil(away.expiresAt)})` : "Menu"
          }
          className="relative h-8 w-8 shrink-0 after:absolute after:-inset-1.5 after:content-['']"
        >
          <Menu className="h-4 w-4" />
          {/* The sidebar's amber cup is out of sight here: Away still shows. */}
          {away && (
            <span
              aria-hidden
              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500"
            />
          )}
        </Button>
      )}

      {/* Session/Tab navigation */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          onClick={handlePrev}
          onTouchEnd={(e) => e.stopPropagation()}
          disabled={!hasPrev || isNavigating}
          className="hover:bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-50 max-[429px]:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Session selector dropdown */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hover:bg-accent active:bg-accent flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1"
            >
              <span className="truncate text-sm font-medium">
                {session?.name || (drafting ? "New session" : "No session")}
                {projectName &&
                  projectName !== "Uncategorized" &&
                  projectName !== "Scratch" && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      [{projectName}]
                    </span>
                  )}
              </span>
              <HostBadge hostId={session?.host_id} />
              <ChevronDown className="text-muted-foreground h-3 w-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="max-h-[300px] min-w-[200px] overflow-y-auto"
          >
            {/* First, so a long session list can't scroll it out of sight. */}
            {session && (
              <MoveMenuItems
                session={session}
                Item={DropdownMenuItem}
                After={DropdownMenuSeparator}
                iconClassName="h-4 w-4"
              />
            )}
            {session?.view === "chat" && (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    shareUiActions.open({
                      kind: "chat",
                      sessionId: session.id,
                      title: session.name,
                    })
                  }
                >
                  <Share2 className="h-4 w-4" />
                  Share…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {sessions
              .filter((s) => !s.conductor_session_id)
              .map((s) => {
                const sessionProject = s.project_id
                  ? projects.find((p) => p.id === s.project_id)
                  : null;
                const isActive = s.id === session?.id;

                return (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => onSelectSession?.(s.id)}
                    className={cn(
                      "flex items-center gap-2",
                      isActive && "bg-accent"
                    )}
                  >
                    <Circle
                      className={cn(
                        "h-2 w-2",
                        isActive
                          ? "fill-primary text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    {sessionProject && !sessionProject.is_uncategorized && (
                      <span className="text-muted-foreground text-xs">
                        [{sessionProject.name}]
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={handleNext}
          onTouchEnd={(e) => e.stopPropagation()}
          disabled={!hasNext || isNavigating}
          className="hover:bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-50 max-[429px]:hidden"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {bookmarksSessionId && (
        <ChatBookmarksButton
          sessionId={bookmarksSessionId}
          className="-my-1.5 h-11 min-w-11 max-[429px]:hidden"
        />
      )}
      {onFind && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Find in conversation"
          onClick={(e) => {
            e.stopPropagation();
            onFind();
          }}
          className="-my-1.5 h-11 w-11 shrink-0 max-[429px]:hidden"
        >
          <TextSearch className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Command palette"
        onClick={(e) => {
          e.stopPropagation();
          paletteActions.open();
        }}
        // 44px targets in a 32px bar row, via -my-1.5.
        className="-my-1.5 h-11 w-11 shrink-0 max-[429px]:hidden"
      >
        <Search className="h-4 w-4" />
      </Button>
      {/* Below 430px Find, Palette and Bookmarks fold into one menu. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
            className="-my-1.5 hidden h-11 w-11 shrink-0 max-[429px]:flex"
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {onFind && (
            <DropdownMenuItem className="h-11 gap-2" onSelect={onFind}>
              <TextSearch className="h-4 w-4" />
              Find in conversation
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="h-11 gap-2"
            onSelect={() => paletteActions.open()}
          >
            <Search className="h-4 w-4" />
            Command palette
          </DropdownMenuItem>
          {bookmarksSessionId && (
            <DropdownMenuItem
              className="h-11 gap-2"
              onSelect={() => bookmarksUiActions.openChat(bookmarksSessionId)}
            >
              <Star className="h-4 w-4" />
              Bookmarks
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="New session"
        onClick={(e) => {
          e.stopPropagation();
          newDraft({ kind: "current" });
        }}
        className="-my-1.5 h-11 w-11 shrink-0"
      >
        <Plus className="h-4 w-4" />
      </Button>
      <SessionPrStage sessionId={session?.id} />
      <ViewSwitch session={session} />

      {session?.working_directory && (
        <MobileViewPicker
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          isLocalSession={isLocalSession}
          hasLog={hasLog}
          isConductor={isConductor}
          workerCount={workerCount}
        />
      )}
    </div>
  );
}
