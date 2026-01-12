"use client";

import { useState, useEffect } from "react";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { Loader2, AlertCircle, ArrowLeft, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileNode } from "@/lib/file-utils";

interface FileExplorerProps {
  workingDirectory: string;
}

/**
 * File explorer with tree navigation and file viewing
 * Mobile-first design with swipe-back on file view
 */
export function FileExplorer({ workingDirectory }: FileExplorerProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    content: string;
    isBinary: boolean;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Load directory contents
  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(workingDirectory)}`);
        const data = await res.json();

        if (data.error) {
          setError(data.error);
        } else {
          setFiles(data.files || []);
        }
      } catch (err) {
        setError("Failed to load directory");
      } finally {
        setLoading(false);
      }
    };

    loadFiles();
  }, [workingDirectory]);

  // Load file content when clicked
  const handleFileClick = async (path: string) => {
    setLoadingFile(true);

    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setSelectedFile({
          path: data.path,
          content: data.content,
          isBinary: data.isBinary,
        });
      }
    } catch (err) {
      setError("Failed to load file");
    } finally {
      setLoadingFile(false);
    }
  };

  const handleCloseFile = () => {
    setSelectedFile(null);
  };

  // If file is selected, show file viewer (full screen on mobile)
  if (selectedFile) {
    return (
      <FileViewer
        content={selectedFile.content}
        filePath={selectedFile.path}
        isBinary={selectedFile.isBinary}
        onClose={handleCloseFile}
      />
    );
  }

  // Show file tree
  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">Files</p>
          <p className="text-xs text-muted-foreground truncate">
            {workingDirectory}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground p-4">
            <AlertCircle className="w-8 h-8 mb-2" />
            <p className="text-sm text-center">{error}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <p className="text-sm">Empty directory</p>
          </div>
        ) : (
          <FileTree
            nodes={files}
            basePath={workingDirectory}
            onFileClick={handleFileClick}
          />
        )}

        {/* Loading overlay when loading file */}
        {loadingFile && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
