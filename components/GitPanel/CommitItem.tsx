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
    <div className="border-b border-border/30 last:border-b-0">
      {/* Commit summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors",
          expanded && "bg-muted/30"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform flex-shrink-0",
            expanded && "rotate-90"
          )}
        />

        {/* Author avatar */}
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-medium text-primary">
            {authorInitial}
          </span>
        </div>

        {/* Commit info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {commit.shortHash}
            </span>
            <span className="text-sm truncate">{commit.subject}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{commit.author}</span>
            <span>·</span>
            <span>{commit.relativeTime}</span>
          </div>
        </div>

        {/* Stats badge */}
        <div className="flex items-center gap-1 text-xs flex-shrink-0">
          {commit.additions > 0 && (
            <span className="text-green-500 flex items-center">
              <Plus className="w-3 h-3" />
              {commit.additions}
            </span>
          )}
          {commit.deletions > 0 && (
            <span className="text-red-500 flex items-center">
              <Minus className="w-3 h-3" />
              {commit.deletions}
            </span>
          )}
        </div>
      </button>

      {/* Expanded file list */}
      {expanded && (
        <div className="pl-14 pr-3 pb-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
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
            <p className="text-sm text-muted-foreground py-2">No files changed</p>
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
        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-muted/70 transition-colors",
        isSelected && "bg-primary/10 hover:bg-primary/20"
      )}
    >
      <StatusIcon
        className={cn("w-4 h-4 flex-shrink-0", getStatusColor(file.status))}
      />
      <span className="flex-1 text-sm truncate">
        {file.oldPath ? (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">{file.oldPath}</span>
            <ArrowRight className="w-3 h-3" />
            <span>{file.path}</span>
          </span>
        ) : (
          file.path
        )}
      </span>
      <div className="flex items-center gap-1 text-xs flex-shrink-0">
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
