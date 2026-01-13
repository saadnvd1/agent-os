"use client";

import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/file-utils";

interface FileTreeProps {
  nodes: FileNode[];
  basePath: string;
  onFileClick: (path: string) => void;
  depth?: number;
}

/**
 * Recursive file tree component
 * Mobile-optimized with larger touch targets
 * Lazily loads directory contents when expanded
 */
export function FileTree({ nodes, basePath, onFileClick, depth = 0 }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedChildren, setLoadedChildren] = useState<Map<string, FileNode[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  const fetchChildren = useCallback(async (dirPath: string) => {
    if (loadedChildren.has(dirPath)) return;

    setLoadingDirs(prev => new Set(prev).add(dirPath));
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.files) {
        setLoadedChildren(prev => new Map(prev).set(dirPath, data.files));
      }
    } catch (err) {
      console.error("Failed to load directory:", err);
    } finally {
      setLoadingDirs(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, [loadedChildren]);

  const toggleExpand = useCallback(async (path: string) => {
    const isCurrentlyExpanded = expanded.has(path);

    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

    // Fetch children if expanding and not already loaded
    if (!isCurrentlyExpanded && !loadedChildren.has(path)) {
      await fetchChildren(path);
    }
  }, [expanded, loadedChildren, fetchChildren]);

  return (
    <div className="w-full">
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isDirectory = node.type === "directory";
        const isLoading = loadingDirs.has(node.path);
        const children = loadedChildren.get(node.path) || node.children;

        return (
          <div key={node.path}>
            {/* File/Directory item */}
            <button
              onClick={() => {
                if (isDirectory) {
                  toggleExpand(node.path);
                } else {
                  onFileClick(node.path);
                }
              }}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 hover:bg-accent transition-colors text-left",
                "min-h-[40px] md:min-h-[32px]", // Touch target
                "text-sm"
              )}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {/* Expand/collapse icon */}
              {isDirectory && (
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  {isLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  ) : isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </span>
              )}

              {/* Icon */}
              <span className="flex-shrink-0">
                {isDirectory ? (
                  isExpanded ? (
                    <FolderOpen className="w-4 h-4 text-blue-400" />
                  ) : (
                    <Folder className="w-4 h-4 text-blue-400" />
                  )
                ) : (
                  <FileIcon extension={node.extension || ""} />
                )}
              </span>

              {/* Name */}
              <span className={cn(
                "flex-1 truncate",
                isDirectory ? "font-medium" : "text-muted-foreground"
              )}>
                {node.name}
              </span>

              {/* Size (files only, on desktop) */}
              {!isDirectory && node.size !== undefined && (
                <span className="hidden md:block text-xs text-muted-foreground flex-shrink-0">
                  {formatFileSize(node.size)}
                </span>
              )}
            </button>

            {/* Children (if expanded) */}
            {isDirectory && isExpanded && children && children.length > 0 && (
              <FileTree
                nodes={children}
                basePath={basePath}
                onFileClick={onFileClick}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * File icon based on extension
 */
function FileIcon({ extension }: { extension: string }) {
  const ext = extension.toLowerCase();

  // Color coding by file type
  const colorMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "text-yellow-400",
    jsx: "text-yellow-400",
    ts: "text-blue-400",
    tsx: "text-blue-400",
    // Styles
    css: "text-pink-400",
    scss: "text-pink-400",
    // Markup
    html: "text-orange-400",
    xml: "text-orange-400",
    // Data
    json: "text-green-400",
    yaml: "text-purple-400",
    yml: "text-purple-400",
    // Config
    md: "text-blue-300",
    toml: "text-gray-400",
    env: "text-yellow-300",
  };

  const color = colorMap[ext] || "text-muted-foreground";

  return <File className={cn("w-4 h-4", color)} />;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
