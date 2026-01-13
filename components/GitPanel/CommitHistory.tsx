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
  const { data: commits, isLoading, error } = useCommitHistory(workingDirectory);
  const [selectedFile, setSelectedFile] = useState<SelectedFileDiff | null>(null);

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
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-muted-foreground">
        <History className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm text-center">Failed to load commit history</p>
      </div>
    );
  }

  if (!commits?.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-muted-foreground">
        <History className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No commits yet</p>
      </div>
    );
  }

  // Mobile: full-screen diff view when file selected
  if (isMobile && selectedFile) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-2 bg-muted/30">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelectedFile(null)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {selectedFile.file.path}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedFile.hash.slice(0, 7)}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {loadingDiff ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
    <div className="flex-1 flex min-h-0">
      {/* Commit list */}
      <div className="w-[300px] flex-shrink-0 overflow-y-auto border-r border-border/50">
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
      <div className="flex-1 flex flex-col min-w-0 bg-muted/20">
        {loadingDiff ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedFile && diff !== undefined ? (
          <>
            <div className="flex items-center gap-2 p-3 bg-background/50">
              <FileCode className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium truncate">
                {selectedFile.file.path}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {selectedFile.hash.slice(0, 7)}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <DiffView diff={diff} fileName={selectedFile.file.path} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <FileCode className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">Select a file to view diff</p>
          </div>
        )}
      </div>
    </div>
  );
}
