"use client";

import {
  FolderOpen,
  GitBranch,
  Home,
  Package,
  ScrollText,
  ClipboardList,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { NotesIcon, useHasNote } from "@/components/Chat/notes";
import { notesUi, notesUiActions } from "@/stores/notesUi";
import type { ViewMode } from "@/contexts/PaneContext";

interface PaneViewToggleProps {
  sessionId?: string;
  // The session runs as a chat, so its main view is the chat, not a terminal.
  isChat?: boolean;
  // The chat on show, whose notes drawer the notebook opens.
  notesSessionId?: string | null;
  viewMode: ViewMode;
  isLocalSession: boolean;
  // Local, and the folder is not known to be outside a git repository.
  showGit: boolean;
  // The task merged and has a log.
  hasLog?: boolean;
  hasReport?: boolean;
  gitDrawerOpen: boolean;
  shellDrawerOpen: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onGitDrawerToggle: () => void;
  onShellDrawerToggle: () => void;
}

function ToggleButton({
  label,
  active,
  onClick,
  className,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={cn(
            "relative flex h-6 items-center rounded px-2 transition-colors",
            active
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
            className
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function NotesToggle({ sessionId }: { sessionId: string }) {
  const { open } = useSnapshot(notesUi);
  const has = useHasNote(sessionId);
  return (
    <ToggleButton
      label={has ? "Notes (has notes)" : "Notes"}
      active={open}
      onClick={() => notesUiActions.toggle(false)}
    >
      <NotesIcon has={has} />
    </ToggleButton>
  );
}

// Files, git and the shell drawer read this machine's disk, so a remote
// session only gets the terminal (and workers).
export function PaneViewToggle({
  sessionId,
  isChat,
  notesSessionId,
  viewMode,
  isLocalSession,
  showGit,
  hasLog,
  hasReport,
  gitDrawerOpen,
  shellDrawerOpen,
  onViewModeChange,
  onGitDrawerToggle,
  onShellDrawerToggle,
}: PaneViewToggleProps) {
  return (
    <div className="bg-accent/50 flex shrink-0 items-center rounded-md p-0.5">
      <ToggleButton
        label={isChat ? "Chat" : "Terminal"}
        active={viewMode === "terminal"}
        onClick={() => onViewModeChange("terminal")}
      >
        <Home className="h-3.5 w-3.5" />
      </ToggleButton>
      {isLocalSession && (
        <>
          <ToggleButton
            label="Files"
            active={viewMode === "files"}
            onClick={() => onViewModeChange("files")}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </ToggleButton>
          {showGit && (
            <ToggleButton
              label="Git"
              active={gitDrawerOpen}
              onClick={onGitDrawerToggle}
            >
              <GitBranch className="h-3.5 w-3.5" />
            </ToggleButton>
          )}
          <ToggleButton
            label="Shell"
            active={shellDrawerOpen}
            onClick={onShellDrawerToggle}
            className="font-mono text-xs"
          >
            {">_"}
          </ToggleButton>
        </>
      )}
      {notesSessionId && <NotesToggle sessionId={notesSessionId} />}
      {sessionId && (
        <ToggleButton
          label="Artifacts"
          active={viewMode === "artifacts"}
          onClick={() => onViewModeChange("artifacts")}
        >
          <Package className="h-3.5 w-3.5" />
        </ToggleButton>
      )}
      {hasReport && (
        <ToggleButton
          label="Report"
          active={viewMode === "report"}
          onClick={() => onViewModeChange("report")}
        >
          <ClipboardList className="h-3.5 w-3.5" />
        </ToggleButton>
      )}
      {hasLog && (
        <ToggleButton
          label="Log"
          active={viewMode === "log"}
          onClick={() => onViewModeChange("log")}
        >
          <ScrollText className="h-3.5 w-3.5" />
        </ToggleButton>
      )}
    </div>
  );
}
