"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch,
  RefreshCw,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  ArrowLeft,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileChanges } from "./FileChanges";
import { CommitForm } from "./CommitForm";
import { PRCreationModal } from "@/components/PRCreationModal";
import { GitPanelTabs, type GitTab } from "./GitPanelTabs";
import { CommitHistory } from "./CommitHistory";
import { DiffView } from "@/components/DiffViewer/DiffModal";
import { useViewport } from "@/hooks/useViewport";
import type { GitStatus, GitFile } from "@/lib/git-status";

interface GitPanelProps {
  workingDirectory: string;
  onFileSelect?: (file: GitFile, diff: string) => void;
}

interface SelectedFile {
  file: GitFile;
  diff: string;
}

export function GitPanel({ workingDirectory }: GitPanelProps) {
  const { isMobile } = useViewport();
  const [activeTab, setActiveTab] = useState<GitTab>("changes");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);

  // Selected file for diff view
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Resizable panel state (desktop)
  const [listWidth, setListWidth] = useState(300);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

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
    setSelectedFile(null);
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  };

  const handleFileClick = async (file: GitFile) => {
    setLoadingDiff(true);
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
        setSelectedFile({ file, diff: data.diff });
      }
    } catch {
      // Ignore errors
    } finally {
      setLoadingDiff(false);
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
      // Update selected file's staged status if it's the same file
      if (selectedFile?.file.path === file.path) {
        setSelectedFile({ ...selectedFile, file: { ...file, staged: true } });
      }
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
      // Update selected file's staged status if it's the same file
      if (selectedFile?.file.path === file.path) {
        setSelectedFile({ ...selectedFile, file: { ...file, staged: false } });
      }
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

  if (error) {
    return (
      <div className="bg-background flex h-full w-full flex-col">
        <Header
          branch=""
          ahead={0}
          behind={0}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <AlertCircle className="text-muted-foreground mb-2 h-8 w-8" />
          <p className="text-muted-foreground text-center text-sm">{error}</p>
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
        refreshing={refreshing}
        showPRModal={showPRModal}
        workingDirectory={workingDirectory}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={handleRefresh}
        onFileClick={handleFileClick}
        onStage={handleStage}
        onUnstage={handleUnstage}
        onStageAll={handleStageAll}
        onUnstageAll={handleUnstageAll}
        onBack={() => setSelectedFile(null)}
        onCommit={fetchStatus}
        onShowPRModal={() => setShowPRModal(true)}
        onClosePRModal={() => setShowPRModal(false)}
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
          refreshing={refreshing}
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
            refreshing={refreshing}
          />
          <GitPanelTabs activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1 overflow-y-auto">
            {!hasChanges ? (
              <div className="text-muted-foreground flex h-32 flex-col items-center justify-center">
                <p className="text-sm">No changes</p>
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
            isOnMainBranch={
              status.branch === "main" || status.branch === "master"
            }
            branch={status.branch}
            onCommit={fetchStatus}
            onCreatePR={() => setShowPRModal(true)}
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
      />
      <GitPanelTabs activeTab={activeTab} onTabChange={onTabChange} />

      <div className="flex-1 overflow-y-auto">
        {!hasChanges ? (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center">
            <p className="text-sm">No changes</p>
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
        isOnMainBranch={status.branch === "main" || status.branch === "master"}
        branch={status.branch}
        onCommit={onCommit}
        onCreatePR={onShowPRModal}
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
}

function Header({ branch, ahead, behind, onRefresh, refreshing }: HeaderProps) {
  return (
    <div className="flex items-center gap-2 p-3">
      <GitBranch className="text-muted-foreground h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{branch || "Git Status"}</p>
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
