"use client";

import { useState, useRef, useCallback } from "react";
import {
  File,
  Plus,
  Minus,
  Edit3,
  ArrowRight,
  ChevronRight,
  Check,
  MoreVertical,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { GitFile } from "@/lib/git-status";
import type { MultiRepoGitFile } from "@/lib/multi-repo-git";

type AnyGitFile = GitFile | MultiRepoGitFile;

interface FileChangesProps {
  files: AnyGitFile[];
  title: string;
  emptyMessage: string;
  selectedPath?: string;
  onFileClick: (file: AnyGitFile) => void;
  onStage?: (file: AnyGitFile) => void;
  onUnstage?: (file: AnyGitFile) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onDiscard?: (file: AnyGitFile) => void;
  isStaged?: boolean;
  groupByRepo?: boolean;
}

const SWIPE_THRESHOLD = 80;

export function FileChanges({
  files,
  title,
  emptyMessage,
  selectedPath,
  onFileClick,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onDiscard,
  isStaged = false,
  groupByRepo = false,
}: FileChangesProps) {
  const [expanded, setExpanded] = useState(true);

  if (files.length === 0) {
    return null;
  }

  const showAllButton = files.length > 1 && (onStageAll || onUnstageAll);

  // Group files by repo if enabled
  const groupedFiles = groupByRepo
    ? (() => {
        const grouped = new Map<string, AnyGitFile[]>();
        for (const f of files) {
          const repoKey = "repoName" in f && f.repoName ? f.repoName : "";
          const existing = grouped.get(repoKey) || [];
          existing.push(f);
          grouped.set(repoKey, existing);
        }
        return Array.from(grouped.entries());
      })()
    : [["", files] as [string, AnyGitFile[]]];

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm font-medium transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              expanded && "rotate-90"
            )}
          />
          <span>{title}</span>
        </button>
        <span className="bg-muted ml-auto rounded-full px-2 py-0.5 text-xs">
          {files.length}
        </span>
        {showAllButton && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              isStaged ? onUnstageAll?.() : onStageAll?.();
            }}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            {isStaged ? (
              <Minus className="h-3 w-3" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            All
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-0.5">
          {groupedFiles.map(([repoName, repoFiles]) => (
            <div key={repoName || "default"}>
              {repoName && (
                <div className="bg-muted/30 text-muted-foreground mx-2 mt-2 mb-1 rounded px-2 py-1 text-xs font-medium">
                  {repoName}
                </div>
              )}
              {repoFiles.map((file) => {
                const fileKey =
                  "repoPath" in file
                    ? `${file.repoPath}-${file.path}`
                    : file.path;
                return (
                  <FileItem
                    key={fileKey}
                    file={file}
                    isSelected={file.path === selectedPath}
                    onClick={() => onFileClick(file)}
                    onStage={onStage ? () => onStage(file) : undefined}
                    onUnstage={onUnstage ? () => onUnstage(file) : undefined}
                    onDiscard={onDiscard ? () => onDiscard(file) : undefined}
                    onSwipeLeft={isStaged ? () => onUnstage?.(file) : undefined}
                    onSwipeRight={!isStaged ? () => onStage?.(file) : undefined}
                    isStaged={isStaged}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FileItemProps {
  file: AnyGitFile;
  isSelected?: boolean;
  onClick: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  isStaged: boolean;
}

function FileItem({
  file,
  isSelected = false,
  onClick,
  onStage,
  onUnstage,
  onDiscard,
  onSwipeLeft,
  onSwipeRight,
  isStaged,
}: FileItemProps) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping) return;

      const currentX = e.touches[0].clientX;
      const diff = currentX - startXRef.current;

      // Limit swipe direction based on whether we can stage/unstage
      if (diff > 0 && !onSwipeRight) return;
      if (diff < 0 && !onSwipeLeft) return;

      // Add resistance at the edges
      const maxSwipe = 100;
      const resistedDiff =
        diff > 0 ? Math.min(diff, maxSwipe) : Math.max(diff, -maxSwipe);

      setSwipeOffset(resistedDiff);
    },
    [isSwiping, onSwipeLeft, onSwipeRight]
  );

  const handleTouchEnd = useCallback(() => {
    setIsSwiping(false);

    // Trigger action if swipe threshold reached
    if (swipeOffset > SWIPE_THRESHOLD && onSwipeRight) {
      onSwipeRight();
    } else if (swipeOffset < -SWIPE_THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    }

    // Reset position
    setSwipeOffset(0);
  }, [swipeOffset, onSwipeLeft, onSwipeRight]);

  const statusIcon = getStatusIcon(file.status);
  const statusColor = getStatusColor(file.status);
  const fileName = file.path.split("/").pop() || file.path;
  const filePath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      ref={containerRef}
      className="group relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background action indicators */}
      <div className="absolute inset-0 flex">
        {/* Stage indicator (swipe right) */}
        {onSwipeRight && (
          <div
            className={cn(
              "flex items-center justify-start bg-green-500/20 pl-4",
              swipeOffset > 0 ? "flex-1" : "w-0"
            )}
            style={{ width: swipeOffset > 0 ? `${swipeOffset}px` : 0 }}
          >
            {swipeOffset > SWIPE_THRESHOLD / 2 && (
              <Plus className="h-5 w-5 text-green-500" />
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Unstage indicator (swipe left) */}
        {onSwipeLeft && (
          <div
            className={cn(
              "flex items-center justify-end bg-yellow-500/20 pr-4",
              swipeOffset < 0 ? "flex-1" : "w-0"
            )}
            style={{
              width: swipeOffset < 0 ? `${Math.abs(swipeOffset)}px` : 0,
            }}
          >
            {swipeOffset < -SWIPE_THRESHOLD / 2 && (
              <Minus className="h-5 w-5 text-yellow-500" />
            )}
          </div>
        )}
      </div>

      {/* File item */}
      <div
        className={cn(
          "relative flex w-full items-center gap-2 px-3 py-2 text-sm",
          "transition-colors",
          "min-h-[44px]", // Mobile touch target
          isSelected ? "bg-accent" : "bg-background hover:bg-accent/50"
        )}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* Clickable area for file */}
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {/* Status icon */}
          <span className={cn("flex-shrink-0", statusColor)}>{statusIcon}</span>

          {/* File info */}
          <div className="min-w-0 flex-1">
            <span className="block truncate">{fileName}</span>
            {filePath && (
              <span className="text-muted-foreground block truncate text-xs">
                {filePath}
              </span>
            )}
          </div>
        </button>

        {/* Action buttons - visible on hover (desktop) */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {/* Stage/Unstage button */}
          {isStaged
            ? onUnstage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage();
                  }}
                  className="hover:bg-accent flex h-7 w-7 items-center justify-center rounded text-yellow-500 transition-colors"
                  title="Unstage"
                >
                  <Minus className="h-4 w-4" />
                </button>
              )
            : onStage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage();
                  }}
                  className="hover:bg-accent flex h-7 w-7 items-center justify-center rounded text-green-500 transition-colors"
                  title="Stage"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}

          {/* Context menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-7 w-7 items-center justify-center rounded transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isStaged
                ? onUnstage && (
                    <DropdownMenuItem onClick={onUnstage}>
                      <Minus className="mr-2 h-4 w-4" />
                      Unstage
                    </DropdownMenuItem>
                  )
                : onStage && (
                    <DropdownMenuItem onClick={onStage}>
                      <Plus className="mr-2 h-4 w-4" />
                      Stage
                    </DropdownMenuItem>
                  )}
              {onDiscard && !isStaged && (
                <DropdownMenuItem
                  onClick={onDiscard}
                  className="text-red-500 focus:text-red-500"
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Discard Changes
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Staged indicator - always visible */}
        {isStaged && (
          <Check className="h-4 w-4 flex-shrink-0 text-green-500 group-hover:hidden" />
        )}

        {/* Arrow - visible when not hovering */}
        <ArrowRight className="text-muted-foreground h-4 w-4 flex-shrink-0 group-hover:hidden" />
      </div>
    </div>
  );
}

function getStatusIcon(status: GitFile["status"]) {
  switch (status) {
    case "modified":
      return <Edit3 className="h-4 w-4" />;
    case "added":
    case "untracked":
      return <Plus className="h-4 w-4" />;
    case "deleted":
      return <Minus className="h-4 w-4" />;
    case "renamed":
      return <ArrowRight className="h-4 w-4" />;
    default:
      return <File className="h-4 w-4" />;
  }
}

function getStatusColor(status: GitFile["status"]): string {
  switch (status) {
    case "modified":
      return "text-yellow-500";
    case "added":
    case "untracked":
      return "text-green-500";
    case "deleted":
      return "text-red-500";
    case "renamed":
      return "text-blue-500";
    default:
      return "text-muted-foreground";
  }
}
