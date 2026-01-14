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

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
];

interface ImagePickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function ImagePicker({
  initialPath,
  onSelect,
  onClose,
}: ImagePickerProps) {
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
          <h3 className="text-sm font-medium">Select Image</h3>
          <p className="text-muted-foreground truncate text-xs">
            {currentPath}
          </p>
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
        ) : files.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center">
            <p className="text-sm">Empty directory</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
                    "flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors",
                    isClickable
                      ? "hover:bg-muted/50 hover:border-primary/50 cursor-pointer"
                      : "cursor-not-allowed opacity-40",
                    isImg && "border-primary/30 bg-primary/5"
                  )}
                >
                  {isDir ? (
                    <Folder className="text-primary/70 h-10 w-10" />
                  ) : isImg ? (
                    <div className="bg-muted flex h-10 w-10 items-center justify-center overflow-hidden rounded">
                      <ImageIcon className="text-primary h-6 w-6" />
                    </div>
                  ) : (
                    <div className="bg-muted/50 flex h-10 w-10 items-center justify-center rounded">
                      <span className="text-muted-foreground text-xs">
                        {node.extension?.toUpperCase() || "?"}
                      </span>
                    </div>
                  )}
                  <span className="w-full truncate text-xs">{node.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="border-border border-t p-3 text-center">
        <p className="text-muted-foreground text-xs">
          Click an image to select it, or navigate into folders
        </p>
      </div>
    </div>
  );
}
