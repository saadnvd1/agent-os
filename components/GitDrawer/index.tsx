"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  RefreshCw,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  X,
  AlertTriangle,
  ExternalLink,
  GitPullRequest,
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
import { FileEditDialog } from "./FileEditDialog";
import { cn } from "@/lib/utils";
import { useDrawerAnimation } from "@/hooks/useDrawerAnimation";
import {
  useGitStatus,
  usePRStatus,
  useCreatePR,
  useStageFiles,
  useUnstageFiles,
  useMultiRepoGitStatus,
  gitKeys,
} from "@/data/git/queries";
import type { GitFile } from "@/lib/git-status";
import type { MultiRepoGitFile } from "@/lib/multi-repo-git";
import type { ProjectRepository } from "@/lib/db";

interface GitDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
  projectId?: string;
  repositories?: ProjectRepository[];
}

export function GitDrawer({
  open,
  onOpenChange,
  workingDirectory,
  projectId,
  repositories = [],
}: GitDrawerProps) {
  const queryClient = useQueryClient();

  // Determine if we're in multi-repo mode
  const isMultiRepo = repositories.length > 0;

  // Single-repo mode hooks - only poll when drawer is open
  const singleRepoQuery = useGitStatus(workingDirectory, {
    enabled: open && !isMultiRepo,
  });

  // Multi-repo mode hooks
  const multiRepoQuery = useMultiRepoGitStatus(projectId, workingDirectory, {
    enabled: open && isMultiRepo,
  });

  // Unified status based on mode
  const loading = isMultiRepo
    ? multiRepoQuery.isPending
    : singleRepoQuery.isPending;
  const isError = isMultiRepo
    ? multiRepoQuery.isError
    : singleRepoQuery.isError;
  const error = isMultiRepo ? multiRepoQuery.error : singleRepoQuery.error;
  const isRefetching = isMultiRepo
    ? multiRepoQuery.isRefetching
    : singleRepoQuery.isRefetching;

  // Convert to unified status
  const status = isMultiRepo
    ? multiRepoQuery.data
      ? {
          branch:
            multiRepoQuery.data.repositories.length === 1
              ? multiRepoQuery.data.repositories[0]?.branch || ""
              : `${multiRepoQuery.data.repositories.length} repos`,
          ahead: multiRepoQuery.data.repositories.reduce(
            (sum, r) => sum + r.ahead,
            0
          ),
          behind: multiRepoQuery.data.repositories.reduce(
            (sum, r) => sum + r.behind,
            0
          ),
          staged: multiRepoQuery.data.staged,
          unstaged: multiRepoQuery.data.unstaged,
          untracked: multiRepoQuery.data.untracked,
        }
      : null
    : singleRepoQuery.data || null;

  const refetchStatus = isMultiRepo
    ? multiRepoQuery.refetch
    : singleRepoQuery.refetch;

  // For PR status, use the primary repo or first repo in multi-repo mode
  const primaryRepoPath = isMultiRepo
    ? repositories.find((r) => r.is_primary)?.path ||
      repositories[0]?.path ||
      workingDirectory
    : workingDirectory;

  const { data: prData } = usePRStatus(primaryRepoPath);
  const existingPR = prData?.existingPR ?? null;

  const createPRMutation = useCreatePR(primaryRepoPath);
  const stageMutation = useStageFiles(primaryRepoPath);
  const unstageMutation = useUnstageFiles(primaryRepoPath);

  // Local UI state
  const [selectedFile, setSelectedFile] = useState<
    GitFile | MultiRepoGitFile | null
  >(null);
  const [discardFile, setDiscardFile] = useState<
    GitFile | MultiRepoGitFile | null
  >(null);
  const [discarding, setDiscarding] = useState(false);

  // Animation
  const isAnimatingIn = useDrawerAnimation(open);

  // Clear selected file when drawer opens
  const handleFileClick = (file: GitFile | MultiRepoGitFile) => {
    setSelectedFile(file);
  };

  const handleStage = async (file: GitFile | MultiRepoGitFile) => {
    // In multi-repo mode, use the file's repoPath
    const repoPath =
      "repoPath" in file && file.repoPath ? file.repoPath : primaryRepoPath;
    try {
      await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repoPath, files: [file.path] }),
      });
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
    } catch {
      // Ignore errors
    }
  };

  const handleUnstage = async (file: GitFile | MultiRepoGitFile) => {
    // In multi-repo mode, use the file's repoPath
    const repoPath =
      "repoPath" in file && file.repoPath ? file.repoPath : primaryRepoPath;
    try {
      await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repoPath, files: [file.path] }),
      });
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
    } catch {
      // Ignore errors
    }
  };

  const handleStageAll = () => {
    stageMutation.mutate(undefined);
  };

  const handleUnstageAll = () => {
    unstageMutation.mutate(undefined);
  };

  const handleDiscardConfirm = async () => {
    if (!discardFile) return;

    setDiscarding(true);
    try {
      // In multi-repo mode, use the file's repoPath
      const repoPath =
        "repoPath" in discardFile && discardFile.repoPath
          ? discardFile.repoPath
          : primaryRepoPath;
      await fetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: repoPath,
          file: discardFile.path,
        }),
      });
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
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

  // In multi-repo mode, determine which repo has staged changes for commit
  const reposWithStagedChanges =
    isMultiRepo && multiRepoQuery.data
      ? multiRepoQuery.data.repositories.filter((repo) =>
          multiRepoQuery.data!.staged.some((f) => f.repoId === repo.id)
        )
      : [];

  // Use the first repo with staged changes, or fall back to primary repo
  const commitRepoPath =
    reposWithStagedChanges.length > 0
      ? reposWithStagedChanges[0].path
      : primaryRepoPath;

  const commitRepoName =
    reposWithStagedChanges.length > 0
      ? reposWithStagedChanges[0].name
      : undefined;

  const commitRepoBranch =
    reposWithStagedChanges.length > 0
      ? reposWithStagedChanges[0].branch
      : status?.branch || "";

  const multipleReposHaveStagedChanges = reposWithStagedChanges.length > 1;

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
              {existingPR && (
                <button
                  onClick={() => window.open(existingPR.url, "_blank")}
                  className="bg-muted hover:bg-accent inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors"
                  title={`${existingPR.title} (#${existingPR.number})`}
                >
                  <GitPullRequest className="h-3 w-3" />
                  View PR
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetchStatus()}
                disabled={isRefetching || loading}
                className="h-7 w-7"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")}
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
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-muted-foreground text-sm">
                {error?.message ?? "Failed to load git status"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchStatus()}
              >
                Retry
              </Button>
            </div>
          ) : stagedFiles.length === 0 && unstagedFiles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="text-muted-foreground text-sm">No changes</span>
              {!isOnMainBranch && !existingPR && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => createPRMutation.mutate()}
                  disabled={createPRMutation.isPending}
                  className="gap-1.5"
                >
                  {createPRMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitPullRequest className="h-3.5 w-3.5" />
                  )}
                  Create PR
                </Button>
              )}
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
                groupByRepo={isMultiRepo}
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
                groupByRepo={isMultiRepo}
              />
            </>
          )}
        </div>

        {/* Commit form at bottom */}
        {status && (
          <CommitForm
            workingDirectory={commitRepoPath}
            stagedCount={stagedFiles.length}
            branch={commitRepoBranch}
            repoName={isMultiRepo ? commitRepoName : undefined}
            multipleReposWarning={multipleReposHaveStagedChanges}
            onCommit={() => {
              queryClient.invalidateQueries({ queryKey: gitKeys.all });
            }}
          />
        )}
      </div>

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
          onSave={() =>
            queryClient.invalidateQueries({
              queryKey: gitKeys.status(workingDirectory),
            })
          }
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
