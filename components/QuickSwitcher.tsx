"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Terminal, GitBranch, Clock, Check } from "lucide-react";
import type { Session } from "@/lib/db";

interface QuickSwitcherProps {
  sessions: Session[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  currentSessionId?: string;
}

/**
 * Quick session switcher with search
 * Triggered by Cmd+K or button tap
 */
export function QuickSwitcher({
  sessions,
  open,
  onOpenChange,
  onSelectSession,
  currentSessionId,
}: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter sessions based on search query
  const filteredSessions = sessions.filter((session) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      session.name?.toLowerCase().includes(q) ||
      session.working_directory?.toLowerCase().includes(q) ||
      session.agent_type?.toLowerCase().includes(q)
    );
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input after a short delay for dialog animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, filteredSessions.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredSessions[selectedIndex]) {
            onSelectSession(filteredSessions[selectedIndex].id);
            onOpenChange(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [filteredSessions, selectedIndex, onSelectSession, onOpenChange]
  );

  // Format relative time
  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>Switch Session</DialogTitle>
        </DialogHeader>

        {/* Search Input */}
        <div className="border-border border-b p-3">
          <Input
            ref={inputRef}
            placeholder="Search sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-10"
          />
        </div>

        {/* Session List */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filteredSessions.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              No sessions found
            </div>
          ) : (
            filteredSessions.map((session, index) => {
              const isCurrent = session.id === currentSessionId;
              return (
                <button
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session.id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    index === selectedIndex
                      ? "bg-accent"
                      : "hover:bg-accent/50",
                    isCurrent && "bg-primary/10"
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md",
                      session.worktree_path
                        ? "bg-purple-500/20 text-purple-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    )}
                  >
                    {session.worktree_path ? (
                      <GitBranch className="h-4 w-4" />
                    ) : (
                      <Terminal className="h-4 w-4" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {session.name || "Unnamed Session"}
                      </span>
                      {isCurrent && (
                        <Check className="text-primary h-3.5 w-3.5 flex-shrink-0" />
                      )}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <span className="truncate">
                        {session.working_directory?.split("/").pop() || "~"}
                      </span>
                      <span>•</span>
                      <span className="capitalize">
                        {session.agent_type || "claude"}
                      </span>
                    </div>
                  </div>

                  {/* Time */}
                  <div className="text-muted-foreground flex flex-shrink-0 items-center gap-1 text-xs">
                    <Clock className="h-3 w-3" />
                    <span>{formatTime(session.updated_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hint */}
        <div className="border-border text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-xs">
          <span>
            <kbd className="bg-muted rounded px-1.5 py-0.5">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="bg-muted rounded px-1.5 py-0.5">↵</kbd> select
          </span>
          <span>
            <kbd className="bg-muted rounded px-1.5 py-0.5">esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
