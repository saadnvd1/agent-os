"use client";

import {
  FolderOpen,
  GitBranch,
  Home,
  Package,
  ScrollText,
  Users,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/contexts/PaneContext";
import { useSessionArtifacts } from "@/data/session-artifacts";

interface PaneViewToggleProps {
  sessionId?: string;
  viewMode: ViewMode;
  isLocalSession: boolean;
  isConductor: boolean;
  // The task merged and has a log.
  hasLog?: boolean;
  workerCount: number;
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

// Files, git and the shell drawer read this machine's disk, so a remote
// session only gets the terminal (and workers).
export function PaneViewToggle({
  sessionId,
  viewMode,
  isLocalSession,
  isConductor,
  hasLog,
  workerCount,
  gitDrawerOpen,
  shellDrawerOpen,
  onViewModeChange,
  onGitDrawerToggle,
  onShellDrawerToggle,
}: PaneViewToggleProps) {
  // Counted only once the view has been opened: closed, it never fetches.
  const artifacts = useSessionArtifacts(sessionId, false).data?.artifacts;
  return (
    <div className="bg-accent/50 flex shrink-0 items-center rounded-md p-0.5">
      <ToggleButton
        label="Terminal"
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
          <ToggleButton
            label="Git"
            active={gitDrawerOpen}
            onClick={onGitDrawerToggle}
          >
            <GitBranch className="h-3.5 w-3.5" />
          </ToggleButton>
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
      {sessionId && (
        <ToggleButton
          label="Artifacts"
          active={viewMode === "artifacts"}
          onClick={() => onViewModeChange("artifacts")}
        >
          <Package className="h-3.5 w-3.5" />
          {!!artifacts?.length && (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-medium">
              {artifacts.length}
            </span>
          )}
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
      {isConductor && (
        <ToggleButton
          label="Workers"
          active={viewMode === "workers"}
          onClick={() => onViewModeChange("workers")}
        >
          <Users className="h-3.5 w-3.5" />
          <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full text-[9px] font-medium">
            {workerCount}
          </span>
        </ToggleButton>
      )}
    </div>
  );
}
