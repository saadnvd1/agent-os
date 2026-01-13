"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Folder,
  Image as ImageIcon,
  ChevronLeft,
  Loader2,
  Home,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/file-utils";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];

interface ImagePickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function ImagePicker({ initialPath, onSelect, onClose }: ImagePickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "~");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setFiles([]);
      } else {
        // Sort: directories first, then files
        const sorted = (data.files || []).sort((a: FileNode, b: FileNode) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sorted);
        setCurrentPath(data.path || path);
      }
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

  const handleItemClick = (node: FileNode) => {
    if (node.type === "directory") {
      navigateTo(node.path);
    } else if (isImage(node)) {
      onSelect(node.path);
    }
  };

  const isImage = (node: FileNode) => {
    if (node.type !== "file") return false;
    const ext = node.extension?.toLowerCase() || "";
    return IMAGE_EXTENSIONS.includes(ext);
  };

  // Get path segments for breadcrumb
  const pathSegments = currentPath.split("/").filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <Button variant="ghost" size="icon-sm" onClick={onClose} className="h-9 w-9">
          <X className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium">Select Image</h3>
          <p className="text-xs text-muted-foreground truncate">{currentPath}</p>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateHome}
          className="h-8 w-8 shrink-0"
          title="Home"
        >
          <Home className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateUp}
          className="h-8 w-8 shrink-0"
          title="Go up"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground overflow-x-auto">
          <span>/</span>
          {pathSegments.map((segment, i) => (
            <button
              key={i}
              onClick={() => navigateTo("/" + pathSegments.slice(0, i + 1).join("/"))}
              className="flex items-center hover:text-foreground transition-colors shrink-0"
            >
              <span className="max-w-[100px] truncate">{segment}</span>
              {i < pathSegments.length - 1 && <ChevronRight className="w-3 h-3 mx-0.5" />}
            </button>
          ))}
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
            <p className="text-sm text-center">{error}</p>
            <Button variant="outline" size="sm" onClick={navigateUp} className="mt-2">
              Go back
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <p className="text-sm">Empty directory</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 p-3">
            {files.map((node) => {
              const isImg = isImage(node);
              const isDir = node.type === "directory";
              const isClickable = isImg || isDir;

              return (
                <button
                  key={node.path}
                  onClick={() => isClickable && handleItemClick(node)}
                  disabled={!isClickable}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors text-center",
                    isClickable
                      ? "hover:bg-muted/50 hover:border-primary/50 cursor-pointer"
                      : "opacity-40 cursor-not-allowed",
                    isImg && "border-primary/30 bg-primary/5"
                  )}
                >
                  {isDir ? (
                    <Folder className="w-10 h-10 text-primary/70" />
                  ) : isImg ? (
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center overflow-hidden">
                      <ImageIcon className="w-6 h-6 text-primary" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded bg-muted/50 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">
                        {node.extension?.toUpperCase() || "?"}
                      </span>
                    </div>
                  )}
                  <span className="text-xs truncate w-full">{node.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="p-3 border-t border-border text-center">
        <p className="text-xs text-muted-foreground">
          Click an image to select it, or navigate into folders
        </p>
      </div>
    </div>
  );
}
