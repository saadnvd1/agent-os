"use client";

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  GitPullRequest,
  RefreshCw,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  ArrowLeft,
  FileCode,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileChanges } from "./FileChanges";
import { CommitForm } from "./CommitForm";
import { PRCreationModal } from "@/components/PRCreationModal";
import { GitPanelTabs, type GitTab } from "./GitPanelTabs";
import { CommitHistory } from "./CommitHistory";
import { DiffView } from "@/components/DiffViewer/DiffModal";
import { useViewport } from "@/hooks/useViewport";
import {
  useGitStatus,
  usePRStatus,
  useCreatePR,
  useStageFiles,
  useUnstageFiles,
  useMultiRepoGitStatus,
  gitKeys,
} from "@/data/git/queries";
import type { GitStatus, GitFile } from "@/lib/git-status";
import type { MultiRepoGitFile } from "@/lib/multi-repo-git";
import type { ProjectRepository } from "@/lib/db";

interface GitPanelProps {
  workingDirectory: string;
  projectId?: string;
  repositories?: ProjectRepository[];
  onFileSelect?: (file: GitFile, diff: string) => void;
}

interface SelectedFile {
  file: GitFile | MultiRepoGitFile;
  diff: string;
  repoPath?: string;
}

export function GitPanel({
  workingDirectory,
  projectId,
  repositories = [],
}: GitPanelProps) {
  const { isMobile } = useViewport();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<GitTab>("changes");
  const [showPRModal, setShowPRModal] = useState(false);

  // Determine if we're in multi-repo mode
  const isMultiRepo = repositories.length > 0;

  // Single-repo mode hooks
  const singleRepoQuery = useGitStatus(workingDirectory, {
    enabled: !isMultiRepo,
  });

  // Multi-repo mode hooks
  const multiRepoQuery = useMultiRepoGitStatus(projectId, workingDirectory, {
    enabled: isMultiRepo,
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

  // Convert multi-repo status to single-repo-like status for unified handling
  const status: GitStatus | null = isMultiRepo
    ? multiRepoQuery.data
      ? {
          // Use first repo's branch or "Multiple"
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

  // Selected file for diff view
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Resizable panel state (desktop)
  const [listWidth, setListWidth] = useState(300);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleRefresh = async () => {
    await refetchStatus();
  };

  const handleFileClick = async (file: GitFile | MultiRepoGitFile) => {
    setLoadingDiff(true);
    try {
      const isUntracked = file.status === "untracked";
      // In multi-repo mode, use the file's repoPath
      const repoPath =
        "repoPath" in file && file.repoPath ? file.repoPath : workingDirectory;
      const params = new URLSearchParams({
        path: repoPath,
        file: file.path,
        staged: file.staged.toString(),
        ...(isUntracked && { untracked: "true" }),
      });

      const res = await fetch(`/api/git/status?${params}`);
      const data = await res.json();

      if (data.diff !== undefined) {
        setSelectedFile({ file, diff: data.diff, repoPath });
      }
    } catch {
      // Ignore errors
    } finally {
      setLoadingDiff(false);
    }
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
      // Invalidate queries to refresh
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
      // Update selected file's staged status if it's the same file
      if (selectedFile?.file.path === file.path) {
        setSelectedFile({ ...selectedFile, file: { ...file, staged: true } });
      }
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
      // Invalidate queries to refresh
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
      // Update selected file's staged status if it's the same file
      if (selectedFile?.file.path === file.path) {
        setSelectedFile({
          ...selectedFile,
          file: { ...file, staged: false },
        });
      }
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

  // Resize handle for desktop
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setListWidth(Math.max(200, Math.min(500, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  if (loading) {
    return (
      <div className="bg-background flex h-full w-full flex-col">
        <Header
          branch=""
          ahead={0}
          behind={0}
          onRefresh={handleRefresh}
          refreshing={false}
        />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-background flex h-full w-full flex-col">
        <Header
          branch=""
          ahead={0}
          behind={0}
          onRefresh={handleRefresh}
          refreshing={isRefetching}
          existingPR={existingPR}
        />
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <AlertCircle className="text-muted-foreground mb-2 h-8 w-8" />
          <p className="text-muted-foreground text-center text-sm">
            {error?.message ?? "Failed to load git status"}
          </p>
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

  // Mobile layout: full-screen list OR full-screen diff
  if (isMobile) {
    return (
      <MobileGitPanel
        status={status}
        hasChanges={hasChanges}
        selectedFile={selectedFile}
        loadingDiff={loadingDiff}
        refreshing={isRefetching}
        showPRModal={showPRModal}
        workingDirectory={workingDirectory}
        activeTab={activeTab}
        existingPR={existingPR}
        creatingPR={createPRMutation.isPending}
        onTabChange={setActiveTab}
        onRefresh={handleRefresh}
        onFileClick={handleFileClick}
        onStage={handleStage}
        onUnstage={handleUnstage}
        onStageAll={handleStageAll}
        onUnstageAll={handleUnstageAll}
        onBack={() => setSelectedFile(null)}
        onCommit={() => {
          queryClient.invalidateQueries({
            queryKey: gitKeys.status(workingDirectory),
          });
          queryClient.invalidateQueries({
            queryKey: gitKeys.pr(workingDirectory),
          });
        }}
        onShowPRModal={() => setShowPRModal(true)}
        onClosePRModal={() => setShowPRModal(false)}
        onCreatePR={() => createPRMutation.mutate()}
      />
    );
  }

  // Desktop layout: side-by-side for Changes, or CommitHistory for History
  if (activeTab === "history") {
    return (
      <div className="bg-background flex h-full w-full flex-col">
        <Header
          branch={status.branch}
          ahead={status.ahead}
          behind={status.behind}
          onRefresh={handleRefresh}
          refreshing={isRefetching}
          existingPR={existingPR}
        />
        <GitPanelTabs activeTab={activeTab} onTabChange={setActiveTab} />
        <CommitHistory workingDirectory={workingDirectory} />
      </div>
    );
  }

  // Desktop layout: side-by-side (Changes tab)
  return (
    <div
      ref={containerRef}
      className="bg-background flex h-full w-full flex-col"
    >
      <div className="flex min-h-0 flex-1">
        {/* Left panel - file list */}
        <div className="flex h-full flex-col" style={{ width: listWidth }}>
          <Header
            branch={status.branch}
            ahead={status.ahead}
            behind={status.behind}
            onRefresh={handleRefresh}
            refreshing={isRefetching}
          />
          <GitPanelTabs activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1 overflow-y-auto">
            {!hasChanges ? (
              <div className="flex h-32 flex-col items-center justify-center gap-3">
                <p className="text-muted-foreground text-sm">No changes</p>
                {status.branch !== "main" &&
                  status.branch !== "master" &&
                  !existingPR && (
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
              <div className="py-2">
                {/* Staged section */}
                {status.staged.length > 0 && (
                  <FileChanges
                    files={status.staged}
                    title="Staged Changes"
                    emptyMessage="No staged changes"
                    selectedPath={selectedFile?.file.path}
                    onFileClick={handleFileClick}
                    onUnstage={handleUnstage}
                    onUnstageAll={handleUnstageAll}
                    isStaged={true}
                  />
                )}

                {/* Unstaged section */}
                {status.unstaged.length > 0 && (
                  <FileChanges
                    files={status.unstaged}
                    title="Changes"
                    emptyMessage="No changes"
                    selectedPath={selectedFile?.file.path}
                    onFileClick={handleFileClick}
                    onStage={handleStage}
                    onStageAll={handleStageAll}
                    isStaged={false}
                  />
                )}

                {/* Untracked section */}
                {status.untracked.length > 0 && (
                  <FileChanges
                    files={status.untracked}
                    title="Untracked Files"
                    emptyMessage="No untracked files"
                    selectedPath={selectedFile?.file.path}
                    onFileClick={handleFileClick}
                    onStage={handleStage}
                    isStaged={false}
                  />
                )}
              </div>
            )}
          </div>

          {/* Commit form */}
          <CommitForm
            workingDirectory={workingDirectory}
            stagedCount={status.staged.length}
            branch={status.branch}
            onCommit={() => {
              queryClient.invalidateQueries({
                queryKey: gitKeys.status(workingDirectory),
              });
              queryClient.invalidateQueries({
                queryKey: gitKeys.pr(workingDirectory),
              });
            }}
          />
        </div>

        {/* Resize handle */}
        <div
          className="bg-muted/50 hover:bg-primary/50 active:bg-primary w-1 flex-shrink-0 cursor-col-resize transition-colors"
          onMouseDown={handleMouseDown}
        />

        {/* Right panel - diff viewer */}
        <div className="bg-muted/20 flex h-full min-w-0 flex-1 flex-col">
          {loadingDiff ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : selectedFile ? (
            <>
              {/* Diff header with stage/unstage */}
              <div className="bg-background/50 flex items-center gap-2 p-3">
                <FileCode className="text-muted-foreground h-4 w-4" />
                <span className="flex-1 truncate text-sm font-medium">
                  {selectedFile.file.path}
                </span>
                <Button
                  variant={selectedFile.file.staged ? "outline" : "default"}
                  size="sm"
                  onClick={() =>
                    selectedFile.file.staged
                      ? handleUnstage(selectedFile.file)
                      : handleStage(selectedFile.file)
                  }
                >
                  {selectedFile.file.staged ? (
                    <>
                      <Minus className="mr-1 h-4 w-4" />
                      Unstage
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1 h-4 w-4" />
                      Stage
                    </>
                  )}
                </Button>
              </div>
              {/* Diff content */}
              <div className="flex-1 overflow-auto p-3">
                <DiffView
                  diff={selectedFile.diff}
                  fileName={selectedFile.file.path}
                />
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center">
              <FileCode className="mb-4 h-12 w-12 opacity-50" />
              <p className="text-sm">Select a file to view diff</p>
            </div>
          )}
        </div>
      </div>

      {/* PR Creation Modal */}
      {showPRModal && (
        <PRCreationModal
          workingDirectory={workingDirectory}
          onClose={() => setShowPRModal(false)}
        />
      )}
    </div>
  );
}

// Mobile layout component
interface MobileGitPanelProps {
  status: GitStatus;
  hasChanges: boolean;
  selectedFile: SelectedFile | null;
  loadingDiff: boolean;
  refreshing: boolean;
  showPRModal: boolean;
  workingDirectory: string;
  activeTab: GitTab;
  existingPR: {
    number: number;
    url: string;
    state: string;
    title: string;
  } | null;
  creatingPR: boolean;
  onTabChange: (tab: GitTab) => void;
  onRefresh: () => void;
  onFileClick: (file: GitFile) => void;
  onStage: (file: GitFile) => void;
  onUnstage: (file: GitFile) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onBack: () => void;
  onCommit: () => void;
  onShowPRModal: () => void;
  onClosePRModal: () => void;
  onCreatePR: () => void;
}

function MobileGitPanel({
  status,
  hasChanges,
  selectedFile,
  loadingDiff,
  refreshing,
  showPRModal,
  workingDirectory,
  activeTab,
  existingPR,
  creatingPR,
  onTabChange,
  onRefresh,
  onFileClick,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onBack,
  onCommit,
  onShowPRModal,
  onClosePRModal,
  onCreatePR,
}: MobileGitPanelProps) {
  // History tab
  if (activeTab === "history") {
    return (
      <div className="bg-background flex h-full w-full flex-col">
        <Header
          branch={status.branch}
          ahead={status.ahead}
          behind={status.behind}
          onRefresh={onRefresh}
          refreshing={refreshing}
          existingPR={existingPR}
        />
        <GitPanelTabs activeTab={activeTab} onTabChange={onTabChange} />
        <CommitHistory workingDirectory={workingDirectory} />
      </div>
    );
  }

  // Show diff view when file is selected
  if (selectedFile) {
    return (
      <div className="bg-background flex h-full w-full flex-col">
        {/* Header */}
        <div className="bg-muted/30 flex items-center gap-2 p-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {selectedFile.file.path}
            </p>
          </div>
          <Button
            variant={selectedFile.file.staged ? "outline" : "default"}
            size="sm"
            onClick={() =>
              selectedFile.file.staged
                ? onUnstage(selectedFile.file)
                : onStage(selectedFile.file)
            }
          >
            {selectedFile.file.staged ? "Unstage" : "Stage"}
          </Button>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-auto p-3">
          {loadingDiff ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : (
            <DiffView
              diff={selectedFile.diff}
              fileName={selectedFile.file.path}
            />
          )}
        </div>
      </div>
    );
  }

  // Show file list (Changes tab)
  return (
    <div className="bg-background flex h-full w-full flex-col">
      <Header
        branch={status.branch}
        ahead={status.ahead}
        behind={status.behind}
        onRefresh={onRefresh}
        refreshing={refreshing}
        existingPR={existingPR}
      />
      <GitPanelTabs activeTab={activeTab} onTabChange={onTabChange} />

      <div className="flex-1 overflow-y-auto">
        {!hasChanges ? (
          <div className="flex h-32 flex-col items-center justify-center gap-3">
            <p className="text-muted-foreground text-sm">No changes</p>
            {status.branch !== "main" &&
              status.branch !== "master" &&
              !existingPR && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCreatePR}
                  disabled={creatingPR}
                  className="gap-1.5"
                >
                  {creatingPR ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitPullRequest className="h-3.5 w-3.5" />
                  )}
                  Create PR
                </Button>
              )}
          </div>
        ) : (
          <div className="py-2">
            {/* Staged section */}
            {status.staged.length > 0 && (
              <FileChanges
                files={status.staged}
                title="Staged Changes"
                emptyMessage="No staged changes"
                onFileClick={onFileClick}
                onUnstage={onUnstage}
                onUnstageAll={onUnstageAll}
                isStaged={true}
              />
            )}

            {/* Unstaged section */}
            {status.unstaged.length > 0 && (
              <FileChanges
                files={status.unstaged}
                title="Changes"
                emptyMessage="No changes"
                onFileClick={onFileClick}
                onStage={onStage}
                onStageAll={onStageAll}
                isStaged={false}
              />
            )}

            {/* Untracked section */}
            {status.untracked.length > 0 && (
              <FileChanges
                files={status.untracked}
                title="Untracked Files"
                emptyMessage="No untracked files"
                onFileClick={onFileClick}
                onStage={onStage}
                isStaged={false}
              />
            )}
          </div>
        )}
      </div>

      {/* Commit form */}
      <CommitForm
        workingDirectory={workingDirectory}
        stagedCount={status.staged.length}
        branch={status.branch}
        onCommit={onCommit}
      />

      {/* Mobile hint */}
      {hasChanges && status.staged.length === 0 && (
        <div className="px-3 py-2">
          <p className="text-muted-foreground text-center text-xs">
            Swipe right to stage, left to unstage
          </p>
        </div>
      )}

      {/* PR Creation Modal */}
      {showPRModal && (
        <PRCreationModal
          workingDirectory={workingDirectory}
          onClose={onClosePRModal}
        />
      )}
    </div>
  );
}

interface HeaderProps {
  branch: string;
  ahead: number;
  behind: number;
  onRefresh: () => void;
  refreshing: boolean;
  existingPR?: {
    number: number;
    url: string;
    title: string;
  } | null;
}

function Header({
  branch,
  ahead,
  behind,
  onRefresh,
  refreshing,
  existingPR,
}: HeaderProps) {
  return (
    <div className="flex items-center gap-2 p-3">
      <GitBranch className="text-muted-foreground h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {branch || "Git Status"}
          </p>
          {existingPR && (
            <button
              onClick={() => window.open(existingPR.url, "_blank")}
              className="bg-muted hover:bg-accent inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors"
              title={`${existingPR.title} (#${existingPR.number})`}
            >
              <GitPullRequest className="h-3 w-3" />
              PR
              <ExternalLink className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        {(ahead > 0 || behind > 0) && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {ahead > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-3 w-3" />
                {ahead}
              </span>
            )}
            {behind > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="h-3 w-3" />
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
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
