"use client";

import { useState } from "react";
import { Loader2, History, ArrowLeft, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommitItem } from "./CommitItem";
import { DiffView } from "@/components/DiffViewer/DiffModal";
import { useCommitHistory, useCommitFileDiff } from "@/data/git/queries";
import { useViewport } from "@/hooks/useViewport";
import type { CommitFile } from "@/lib/git-history";

interface CommitHistoryProps {
  workingDirectory: string;
}

interface SelectedFileDiff {
  hash: string;
  file: CommitFile;
}

export function CommitHistory({ workingDirectory }: CommitHistoryProps) {
  const { isMobile } = useViewport();
  const {
    data: commits,
    isLoading,
    error,
  } = useCommitHistory(workingDirectory);
  const [selectedFile, setSelectedFile] = useState<SelectedFileDiff | null>(
    null
  );

  // Fetch diff when file is selected
  const { data: diff, isLoading: loadingDiff } = useCommitFileDiff(
    workingDirectory,
    selectedFile?.hash ?? null,
    selectedFile?.file.path ?? null
  );

  const handleFileClick = (hash: string, file: CommitFile) => {
    setSelectedFile({ hash, file });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center p-4">
        <History className="mb-2 h-8 w-8 opacity-50" />
        <p className="text-center text-sm">Failed to load commit history</p>
      </div>
    );
  }

  if (!commits?.length) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center p-4">
        <History className="mb-2 h-8 w-8 opacity-50" />
        <p className="text-sm">No commits yet</p>
      </div>
    );
  }

  // Mobile: full-screen diff view when file selected
  if (isMobile && selectedFile) {
    return (
      <div className="flex h-full flex-col">
        <div className="bg-muted/30 flex items-center gap-2 p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelectedFile(null)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {selectedFile.file.path}
            </p>
            <p className="text-muted-foreground text-xs">
              {selectedFile.hash.slice(0, 7)}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {loadingDiff ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : (
            <DiffView diff={diff || ""} fileName={selectedFile.file.path} />
          )}
        </div>
      </div>
    );
  }

  // Mobile: commit list only
  if (isMobile) {
    return (
      <div className="flex-1 overflow-y-auto">
        {commits.map((commit) => (
          <CommitItem
            key={commit.hash}
            commit={commit}
            workingDir={workingDirectory}
            onFileClick={handleFileClick}
            selectedFile={
              selectedFile
                ? { hash: selectedFile.hash, path: selectedFile.file.path }
                : null
            }
          />
        ))}
      </div>
    );
  }

  // Desktop: side-by-side layout
  return (
    <div className="flex min-h-0 flex-1">
      {/* Commit list */}
      <div className="border-border/50 w-[300px] flex-shrink-0 overflow-y-auto border-r">
        {commits.map((commit) => (
          <CommitItem
            key={commit.hash}
            commit={commit}
            workingDir={workingDirectory}
            onFileClick={handleFileClick}
            selectedFile={
              selectedFile
                ? { hash: selectedFile.hash, path: selectedFile.file.path }
                : null
            }
          />
        ))}
      </div>

      {/* Diff view */}
      <div className="bg-muted/20 flex min-w-0 flex-1 flex-col">
        {loadingDiff ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : selectedFile && diff !== undefined ? (
          <>
            <div className="bg-background/50 flex items-center gap-2 p-3">
              <FileCode className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 truncate text-sm font-medium">
                {selectedFile.file.path}
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {selectedFile.hash.slice(0, 7)}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <DiffView diff={diff} fileName={selectedFile.file.path} />
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
  );
}
