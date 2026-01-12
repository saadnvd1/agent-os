"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  RefreshCw,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileChanges } from "./FileChanges";
import type { GitStatus, GitFile } from "@/lib/git-status";

interface GitPanelProps {
  workingDirectory: string;
  onFileSelect?: (file: GitFile, diff: string) => void;
}

export function GitPanel({ workingDirectory, onFileSelect }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setStatus(null);
      } else {
        setStatus(data);
        setError(null);
      }
    } catch {
      setError("Failed to fetch git status");
      setStatus(null);
    }
  }, [workingDirectory]);

  useEffect(() => {
    setLoading(true);
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  };

  const handleFileClick = async (file: GitFile) => {
    if (!onFileSelect) return;

    try {
      const isUntracked = file.status === "untracked";
      const params = new URLSearchParams({
        path: workingDirectory,
        file: file.path,
        staged: file.staged.toString(),
        ...(isUntracked && { untracked: "true" }),
      });

      const res = await fetch(`/api/git/status?${params}`);
      const data = await res.json();

      if (data.diff !== undefined) {
        onFileSelect(file, data.diff);
      }
    } catch {
      // Ignore errors
    }
  };

  const handleStage = async (file: GitFile) => {
    try {
      await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDirectory, files: [file.path] }),
      });
      await fetchStatus();
    } catch {
      // Ignore errors
    }
  };

  const handleUnstage = async (file: GitFile) => {
    try {
      await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDirectory, files: [file.path] }),
      });
      await fetchStatus();
    } catch {
      // Ignore errors
    }
  };

  const handleStageAll = async () => {
    try {
      await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDirectory }),
      });
      await fetchStatus();
    } catch {
      // Ignore errors
    }
  };

  const handleUnstageAll = async () => {
    try {
      await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDirectory }),
      });
      await fetchStatus();
    } catch {
      // Ignore errors
    }
  };

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col bg-background">
        <Header
          branch=""
          ahead={0}
          behind={0}
          onRefresh={handleRefresh}
          refreshing={false}
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full w-full flex flex-col bg-background">
        <Header
          branch=""
          ahead={0}
          behind={0}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <AlertCircle className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground text-center">{error}</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const hasChanges =
    status.staged.length > 0 ||
    status.unstaged.length > 0 ||
    status.untracked.length > 0;

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <Header
        branch={status.branch}
        ahead={status.ahead}
        behind={status.behind}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-y-auto">
        {!hasChanges ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <p className="text-sm">No changes</p>
          </div>
        ) : (
          <div className="py-2">
            {/* Staged section */}
            {status.staged.length > 0 && (
              <div className="relative">
                <FileChanges
                  files={status.staged}
                  title="Staged Changes"
                  emptyMessage="No staged changes"
                  onFileClick={handleFileClick}
                  onUnstage={handleUnstage}
                  isStaged={true}
                />
                {status.staged.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUnstageAll}
                    className="absolute top-1 right-2 h-7 text-xs"
                  >
                    <Minus className="w-3 h-3 mr-1" />
                    All
                  </Button>
                )}
              </div>
            )}

            {/* Unstaged section */}
            {status.unstaged.length > 0 && (
              <div className="relative">
                <FileChanges
                  files={status.unstaged}
                  title="Changes"
                  emptyMessage="No changes"
                  onFileClick={handleFileClick}
                  onStage={handleStage}
                  isStaged={false}
                />
                {status.unstaged.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStageAll}
                    className="absolute top-1 right-2 h-7 text-xs"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    All
                  </Button>
                )}
              </div>
            )}

            {/* Untracked section */}
            {status.untracked.length > 0 && (
              <FileChanges
                files={status.untracked}
                title="Untracked Files"
                emptyMessage="No untracked files"
                onFileClick={handleFileClick}
                onStage={handleStage}
                isStaged={false}
              />
            )}
          </div>
        )}
      </div>

      {/* Mobile hint */}
      <div className="md:hidden px-3 py-2 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Swipe right to stage, left to unstage
        </p>
      </div>
    </div>
  );
}

interface HeaderProps {
  branch: string;
  ahead: number;
  behind: number;
  onRefresh: () => void;
  refreshing: boolean;
}

function Header({ branch, ahead, behind, onRefresh, refreshing }: HeaderProps) {
  return (
    <div className="flex items-center gap-2 p-3 border-b border-border">
      <GitBranch className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{branch || "Git Status"}</p>
        {(ahead > 0 || behind > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {ahead > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="w-3 h-3" />
                {ahead}
              </span>
            )}
            {behind > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="w-3 h-3" />
                {behind}
              </span>
            )}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="h-8 w-8"
      >
        <RefreshCw
          className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
        />
      </Button>
    </div>
  );
}
