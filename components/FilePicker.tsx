"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Folder,
  FileIcon,
  FileImage,
  ChevronLeft,
  Loader2,
  Home,
  ChevronRight,
  Upload,
  Clipboard,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFileToTemp } from "@/lib/file-upload";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useViewport } from "@/hooks/useViewport";
import { useDirectoryBrowser } from "@/hooks/useDirectoryBrowser";
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

interface FilePickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function isImageFile(node: FileNode) {
  if (node.type !== "file") return false;
  const ext = node.extension?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.includes(ext);
}

export function FilePicker({
  initialPath,
  onSelect,
  onClose,
}: FilePickerProps) {
  const {
    currentPath,
    filteredFiles,
    loading,
    error,
    search,
    setSearch,
    pathSegments,
    navigateTo,
    navigateUp,
    navigateHome,
  } = useDirectoryBrowser({ initialPath });

  const [uploading, setUploading] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = useViewport();

  // Handle dropped/pasted/selected file
  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const path = await uploadFileToTemp(file);
        if (path) {
          onSelect(path);
        }
      } catch (err) {
        console.error("Failed to upload file:", err);
      } finally {
        setUploading(false);
      }
    },
    [onSelect]
  );

  // Drag and drop (desktop only)
  const { isDragging, dragHandlers } = useFileDrop(dropZoneRef, handleFile, {
    disabled: uploading || isMobile,
  });

  // Clipboard paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            break;
          }
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  const handleItemClick = (node: FileNode) => {
    if (node.type === "directory") {
      navigateTo(node.path);
    } else if (node.type === "file") {
      onSelect(node.path);
    }
  };

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
          <h3 className="text-sm font-medium">Select File</h3>
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

      {/* Upload zone */}
      {isMobile ? (
        <div className="mx-3 mt-3 flex items-center justify-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading ? "Uploading..." : "Upload file"}
          </Button>
          <span className="text-muted-foreground text-xs">
            or select a file below
          </span>
        </div>
      ) : (
        <div
          ref={dropZoneRef}
          {...dragHandlers}
          className={cn(
            "border-border mx-3 mt-3 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors",
            isDragging && "border-primary bg-primary/10",
            uploading && "opacity-50"
          )}
        >
          {uploading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Uploading...</span>
            </div>
          ) : isDragging ? (
            <div className="flex items-center gap-2">
              <Upload className="text-primary h-5 w-5" />
              <span className="text-primary text-sm font-medium">
                Drop file here
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="text-muted-foreground flex items-center gap-2">
                <Upload className="h-4 w-4" />
                <span className="text-sm">Drop file here</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Clipboard className="h-3 w-3" />
                <span>or paste from clipboard</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
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
              {search ? "No matching files" : "Empty directory"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredFiles.map((node) => {
              const isImg = isImageFile(node);
              const isDir = node.type === "directory";
              const isFile = node.type === "file";

              return (
                <button
                  key={node.path}
                  onClick={() => handleItemClick(node)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors",
                    "hover:bg-muted/50 hover:border-primary/50 cursor-pointer",
                    isImg && "border-primary/30 bg-primary/5"
                  )}
                >
                  {isDir ? (
                    <Folder className="text-primary/70 h-10 w-10" />
                  ) : isImg ? (
                    <div className="bg-muted flex h-10 w-10 items-center justify-center overflow-hidden rounded">
                      <FileImage className="text-primary h-6 w-6" />
                    </div>
                  ) : isFile ? (
                    <div className="bg-muted/50 flex h-10 w-10 items-center justify-center rounded">
                      <FileIcon className="text-muted-foreground h-6 w-6" />
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
          Select any file or navigate into folders
        </p>
      </div>
    </div>
  );
}
