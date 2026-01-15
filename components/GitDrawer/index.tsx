"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  RefreshCw,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileChanges } from "@/components/GitPanel/FileChanges";
import { CommitForm } from "@/components/GitPanel/CommitForm";
import { PRCreationModal } from "@/components/PRCreationModal";
import { FileEditDialog } from "./FileEditDialog";
import { cn } from "@/lib/utils";
import { useDrawerAnimation } from "@/hooks/useDrawerAnimation";
import type { GitStatus, GitFile } from "@/lib/git-status";

interface GitDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
}

export function GitDrawer({
  open,
  onOpenChange,
  workingDirectory,
}: GitDrawerProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);

  // Selected file for edit dialog
  const [selectedFile, setSelectedFile] = useState<GitFile | null>(null);

  // Discard confirmation
  const [discardFile, setDiscardFile] = useState<GitFile | null>(null);
  const [discarding, setDiscarding] = useState(false);

  // Animation
  const isAnimatingIn = useDrawerAnimation(open);

  const fetchStatus = useCallback(async () => {
    if (!workingDirectory) return;

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
    if (open && workingDirectory) {
      setLoading(true);
      setSelectedFile(null);
      fetchStatus().finally(() => setLoading(false));

      // Poll every 3 seconds while drawer is open
      const interval = setInterval(() => fetchStatus(), 3000);
      return () => clearInterval(interval);
    }
  }, [open, workingDirectory, fetchStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  };

  const handleFileClick = (file: GitFile) => {
    setSelectedFile(file);
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

  const handleDiscardConfirm = async () => {
    if (!discardFile) return;

    setDiscarding(true);
    try {
      await fetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDirectory,
          file: discardFile.path,
        }),
      });
      await fetchStatus();
      setDiscardFile(null);
    } catch {
      // Ignore errors
    } finally {
      setDiscarding(false);
    }
  };

  const stagedFiles = status?.staged || [];
  const unstagedFiles = [
    ...(status?.unstaged || []),
    ...(status?.untracked || []),
  ];
  const isOnMainBranch = ["main", "master"].includes(status?.branch || "");

  if (!open) return null;

  return (
    <>
      <div
        className={cn(
          "bg-muted/30 flex h-full flex-col transition-all duration-200 ease-out",
          isAnimatingIn
            ? "translate-x-0 opacity-100"
            : "translate-x-4 opacity-0"
        )}
      >
        {/* Header */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Git Changes</span>
              {status && (
                <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                  <GitBranch className="mr-1 inline h-3 w-3" />
                  {status.branch}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing || loading}
                className="h-7 w-7"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-7 w-7"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Ahead/behind indicator */}
          {status && (status.ahead > 0 || status.behind > 0) && (
            <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
              {status.ahead > 0 && (
                <span className="flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" />
                  {status.ahead} ahead
                </span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center gap-1">
                  <ArrowDown className="h-3 w-3" />
                  {status.behind} behind
                </span>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-muted-foreground text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                Retry
              </Button>
            </div>
          ) : stagedFiles.length === 0 && unstagedFiles.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              No changes
            </div>
          ) : (
            <>
              {/* Staged files */}
              <FileChanges
                files={stagedFiles}
                title="Staged Changes"
                emptyMessage="No staged changes"
                onFileClick={handleFileClick}
                onUnstage={handleUnstage}
                onUnstageAll={handleUnstageAll}
                isStaged={true}
              />

              {/* Unstaged files */}
              <FileChanges
                files={unstagedFiles}
                title="Unstaged Changes"
                emptyMessage="No unstaged changes"
                onFileClick={handleFileClick}
                onStage={handleStage}
                onStageAll={handleStageAll}
                onDiscard={setDiscardFile}
                isStaged={false}
              />
            </>
          )}
        </div>

        {/* Commit form at bottom */}
        {status && (
          <CommitForm
            workingDirectory={workingDirectory}
            stagedCount={stagedFiles.length}
            isOnMainBranch={isOnMainBranch}
            branch={status.branch}
            onCommit={fetchStatus}
            onCreatePR={() => setShowPRModal(true)}
          />
        )}
      </div>

      {/* PR Creation Modal */}
      {showPRModal && (
        <PRCreationModal
          workingDirectory={workingDirectory}
          onClose={() => setShowPRModal(false)}
        />
      )}

      {/* File Edit Dialog */}
      {selectedFile && (
        <FileEditDialog
          open={!!selectedFile}
          onOpenChange={(open) => !open && setSelectedFile(null)}
          workingDirectory={workingDirectory}
          file={selectedFile}
          allFiles={[...stagedFiles, ...unstagedFiles]}
          onFileSelect={setSelectedFile}
          onStage={handleStage}
          onUnstage={handleUnstage}
          onSave={fetchStatus}
        />
      )}

      {/* Discard Confirmation Modal */}
      <Dialog
        open={!!discardFile}
        onOpenChange={(o) => !o && setDiscardFile(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Discard Changes
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to discard changes to{" "}
              <span className="font-mono font-medium">
                {discardFile?.path.split("/").pop()}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscardFile(null)}
              disabled={discarding}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscardConfirm}
              disabled={discarding}
            >
              {discarding ? "Discarding..." : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
