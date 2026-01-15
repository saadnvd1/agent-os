"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Folder,
  ChevronLeft,
  Loader2,
  Home,
  ChevronRight,
  Check,
  GitBranch,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/file-utils";

interface FolderPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({
  initialPath,
  onSelect,
  onClose,
}: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "~");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [search, setSearch] = useState("");

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const [filesRes, gitRes] = await Promise.all([
        fetch(`/api/files?path=${encodeURIComponent(path)}`),
        fetch("/api/git/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        }),
      ]);

      const filesData = await filesRes.json();
      const gitData = await gitRes.json();

      if (filesData.error) {
        setError(filesData.error);
        setFiles([]);
      } else {
        // Filter to only directories, sorted alphabetically
        const dirs = (filesData.files || [])
          .filter((f: FileNode) => f.type === "directory")
          .sort((a: FileNode, b: FileNode) => a.name.localeCompare(b.name));
        setFiles(dirs);
        setCurrentPath(filesData.path || path);
      }

      setIsGitRepo(gitData.isGitRepo || false);
    } catch {
      setError("Failed to load directory");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(currentPath);
  }, []);

  const navigateTo = (path: string) => {
    setSearch("");
    loadDirectory(path);
  };

  const navigateUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      navigateTo("/" + parts.join("/"));
    } else {
      navigateTo("/");
    }
  };

  const navigateHome = () => {
    navigateTo("~");
  };

  const handleSelectCurrent = () => {
    onSelect(currentPath);
  };

  // Get path segments for breadcrumb
  const pathSegments = currentPath.split("/").filter(Boolean);

  // Get folder name from path
  const folderName = pathSegments[pathSegments.length - 1] || "root";

  // Filter files by search
  const filteredFiles = search
    ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      {/* Header */}
      <div className="border-border bg-background/95 flex items-center gap-2 border-b p-3 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="h-9 w-9"
        >
          <X className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Select Folder</h3>
          <p className="text-muted-foreground truncate text-xs">
            {currentPath}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="border-border border-b px-3 py-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search folders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
      </div>

      {/* Navigation bar */}
      <div className="border-border flex items-center gap-1 overflow-x-auto border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateHome}
          className="h-8 w-8 shrink-0"
          title="Home"
        >
          <Home className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateUp}
          className="h-8 w-8 shrink-0"
          title="Go up"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-muted-foreground flex items-center gap-0.5 overflow-x-auto text-xs">
          <span>/</span>
          {pathSegments.map((segment, i) => (
            <button
              key={i}
              onClick={() =>
                navigateTo("/" + pathSegments.slice(0, i + 1).join("/"))
              }
              className="hover:text-foreground flex shrink-0 items-center transition-colors"
            >
              <span className="max-w-[100px] truncate">{segment}</span>
              {i < pathSegments.length - 1 && (
                <ChevronRight className="mx-0.5 h-3 w-3" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center p-4">
            <p className="text-center text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={navigateUp}
              className="mt-2"
            >
              Go back
            </Button>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center">
            <p className="text-sm">
              {search ? "No matching folders" : "No subfolders"}
            </p>
          </div>
        ) : (
          <div className="divide-border divide-y">
            {filteredFiles.map((node) => (
              <button
                key={node.path}
                onClick={() => navigateTo(node.path)}
                className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
              >
                <Folder className="text-muted-foreground h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {node.name}
                </span>
                <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer with select button */}
      <div className="border-border flex items-center justify-between gap-3 border-t p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Folder className="text-primary h-5 w-5 shrink-0" />
            <span className="truncate font-medium">{folderName}</span>
            {isGitRepo && (
              <span className="bg-muted text-muted-foreground flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs">
                <GitBranch className="h-3 w-3" />
                Git
              </span>
            )}
          </div>
        </div>
        <Button onClick={handleSelectCurrent} className="shrink-0 gap-2">
          <Check className="h-4 w-4" />
          Select
        </Button>
      </div>
    </div>
  );
}
