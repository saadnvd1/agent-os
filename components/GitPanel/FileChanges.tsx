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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GitFile } from "@/lib/git-status";

interface FileChangesProps {
  files: GitFile[];
  title: string;
  emptyMessage: string;
  selectedPath?: string;
  onFileClick: (file: GitFile) => void;
  onStage?: (file: GitFile) => void;
  onUnstage?: (file: GitFile) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  isStaged?: boolean;
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
  isStaged = false,
}: FileChangesProps) {
  const [expanded, setExpanded] = useState(true);

  if (files.length === 0) {
    return null;
  }

  const showAllButton = files.length > 1 && (onStageAll || onUnstageAll);

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
          {files.map((file) => (
            <FileItem
              key={file.path}
              file={file}
              isSelected={file.path === selectedPath}
              onClick={() => onFileClick(file)}
              onSwipeLeft={isStaged ? () => onUnstage?.(file) : undefined}
              onSwipeRight={!isStaged ? () => onStage?.(file) : undefined}
              isStaged={isStaged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileItemProps {
  file: GitFile;
  isSelected?: boolean;
  onClick: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  isStaged: boolean;
}

function FileItem({
  file,
  isSelected = false,
  onClick,
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
      className="relative overflow-hidden"
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
      <button
        onClick={onClick}
        className={cn(
          "relative flex w-full items-center gap-2 px-3 py-2.5 text-sm",
          "text-left transition-colors",
          "min-h-[44px]", // Mobile touch target
          isSelected ? "bg-accent" : "bg-background hover:bg-accent/50"
        )}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping ? "none" : "transform 0.2s ease-out",
        }}
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

        {/* Staged indicator */}
        {isStaged && <Check className="h-4 w-4 flex-shrink-0 text-green-500" />}

        {/* Arrow */}
        <ArrowRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
      </button>
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
