"use client";

import { useState } from "react";
import {
  ChevronRight,
  Plus,
  Minus,
  FileText,
  FilePlus,
  FileX,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommitDetail } from "@/data/git/queries";
import type { CommitSummary, CommitFile } from "@/lib/git-history";

interface CommitItemProps {
  commit: CommitSummary;
  workingDir: string;
  onFileClick: (hash: string, file: CommitFile) => void;
  selectedFile?: { hash: string; path: string } | null;
}

export function CommitItem({
  commit,
  workingDir,
  onFileClick,
  selectedFile,
}: CommitItemProps) {
  const [expanded, setExpanded] = useState(false);

  // Only fetch detail when expanded
  const { data: detail, isLoading } = useCommitDetail(
    workingDir,
    expanded ? commit.hash : null
  );

  const authorInitial = commit.author.charAt(0).toUpperCase();

  return (
    <div className="border-border/30 border-b last:border-b-0">
      {/* Commit summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "hover:bg-muted/50 flex w-full items-center gap-3 p-3 text-left transition-colors",
          expanded && "bg-muted/30"
        )}
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground h-4 w-4 flex-shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />

        {/* Author avatar */}
        <div className="bg-primary/20 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
          <span className="text-primary text-xs font-medium">
            {authorInitial}
          </span>
        </div>

        {/* Commit info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">
              {commit.shortHash}
            </span>
            <span className="truncate text-sm">{commit.subject}</span>
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
            <span>{commit.author}</span>
            <span>·</span>
            <span>{commit.relativeTime}</span>
          </div>
        </div>

        {/* Stats badge */}
        <div className="flex flex-shrink-0 items-center gap-1 text-xs">
          {commit.additions > 0 && (
            <span className="flex items-center text-green-500">
              <Plus className="h-3 w-3" />
              {commit.additions}
            </span>
          )}
          {commit.deletions > 0 && (
            <span className="flex items-center text-red-500">
              <Minus className="h-3 w-3" />
              {commit.deletions}
            </span>
          )}
        </div>
      </button>

      {/* Expanded file list */}
      {expanded && (
        <div className="pr-3 pb-3 pl-14">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          ) : detail?.files?.length ? (
            <div className="space-y-1">
              {detail.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  isSelected={
                    selectedFile?.hash === commit.hash &&
                    selectedFile?.path === file.path
                  }
                  onClick={() => onFileClick(commit.hash, file)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-2 text-sm">
              No files changed
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface FileRowProps {
  file: CommitFile;
  isSelected: boolean;
  onClick: () => void;
}

function FileRow({ file, isSelected, onClick }: FileRowProps) {
  const StatusIcon = getStatusIcon(file.status);

  return (
    <button
      onClick={onClick}
      className={cn(
        "hover:bg-muted/70 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
        isSelected && "bg-primary/10 hover:bg-primary/20"
      )}
    >
      <StatusIcon
        className={cn("h-4 w-4 flex-shrink-0", getStatusColor(file.status))}
      />
      <span className="flex-1 truncate text-sm">
        {file.oldPath ? (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">{file.oldPath}</span>
            <ArrowRight className="h-3 w-3" />
            <span>{file.path}</span>
          </span>
        ) : (
          file.path
        )}
      </span>
      <div className="flex flex-shrink-0 items-center gap-1 text-xs">
        {file.additions > 0 && (
          <span className="text-green-500">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-red-500">-{file.deletions}</span>
        )}
      </div>
    </button>
  );
}

function getStatusIcon(status: CommitFile["status"]) {
  switch (status) {
    case "added":
      return FilePlus;
    case "deleted":
      return FileX;
    case "renamed":
      return ArrowRight;
    default:
      return FileText;
  }
}

function getStatusColor(status: CommitFile["status"]) {
  switch (status) {
    case "added":
      return "text-green-500";
    case "deleted":
      return "text-red-500";
    case "renamed":
      return "text-yellow-500";
    default:
      return "text-muted-foreground";
  }
}
