"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Home,
  ChevronUp,
  Loader2,
  FolderInput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/file-utils";

interface DirectoryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryPicker({
  open,
  onClose,
  onSelect,
  initialPath = "~",
}: DirectoryPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track home directory path from API
  const [homePath, setHomePath] = useState<string | null>(null);

  // Fetch directory contents
  const fetchDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return { dirs: [], expandedPath: path };
      }
      // Store the home path if we're at ~
      if (path === "~" && data.path) {
        setHomePath(data.path);
      }
      // Filter to only directories
      const dirs = (data.files || []).filter(
        (f: FileNode) => f.type === "directory"
      );
      return { dirs, expandedPath: data.path };
    } catch {
      setError("Failed to load directory");
      return { dirs: [], expandedPath: path };
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial directory
  useEffect(() => {
    if (open) {
      fetchDirectory(currentPath).then(({ dirs }) => setDirectories(dirs));
      setSelectedPath(null);
    }
  }, [open, currentPath, fetchDirectory]);

  // Navigate up to parent
  const goUp = () => {
    if (
      currentPath === "~" ||
      currentPath === "/" ||
      (homePath && currentPath === homePath)
    ) {
      return;
    }
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const newPath = currentPath.startsWith("~")
      ? "~/" + parts.slice(1).join("/") || "~"
      : "/" + parts.join("/") || "/";
    setCurrentPath(newPath);
    setExpanded(new Set());
  };

  // Go to home
  const goHome = () => {
    setCurrentPath("~");
    setExpanded(new Set());
  };

  // Toggle directory expansion and fetch children
  const toggleExpand = async (node: FileNode) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      // Fetch children if not already loaded
      if (!node.children || node.children.length === 0) {
        const { dirs } = await fetchDirectory(node.path);
        // Update the node with children
        setDirectories((prev) => updateNodeChildren(prev, node.path, dirs));
      }
    }
    setExpanded(newExpanded);
  };

  // Select a directory
  const handleSelect = (path: string) => {
    setSelectedPath(path);
  };

  // Confirm selection
  const handleConfirm = () => {
    if (selectedPath) {
      // Convert absolute path back to ~ format if it's in home directory
      let finalPath = selectedPath;
      if (homePath && selectedPath.startsWith(homePath)) {
        finalPath = "~" + selectedPath.slice(homePath.length);
      }
      onSelect(finalPath);
      onClose();
    }
  };

  // Select current directory
  const selectCurrentDirectory = () => {
    // Convert to ~ format if in home directory
    let finalPath = currentPath;
    if (homePath && currentPath.startsWith(homePath)) {
      finalPath = "~" + currentPath.slice(homePath.length);
    }
    onSelect(finalPath);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Select Directory</DialogTitle>
        </DialogHeader>

        {/* Navigation bar */}
        <div className="flex items-center gap-2 border-b pb-2">
          <Button variant="ghost" size="icon-sm" onClick={goHome} title="Home">
            <Home className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goUp}
            disabled={currentPath === "~" || currentPath === "/"}
            title="Go up"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <span className="text-muted-foreground flex-1 truncate font-mono text-sm">
            {currentPath}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={selectCurrentDirectory}
            title="Select this directory"
          >
            <FolderInput className="mr-1 h-4 w-4" />
            Use This
          </Button>
        </div>

        {/* Directory listing */}
        <div className="max-h-[400px] min-h-[200px] flex-1 overflow-y-auto">
          {loading && directories.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-red-500">{error}</div>
          ) : directories.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              No subdirectories
            </div>
          ) : (
            <DirectoryTree
              nodes={directories}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={toggleExpand}
              onSelect={handleSelect}
              onDoubleClick={(path) => {
                setCurrentPath(path);
                setExpanded(new Set());
              }}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPath}>
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DirectoryTreeProps {
  nodes: FileNode[];
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (node: FileNode) => void;
  onSelect: (path: string) => void;
  onDoubleClick: (path: string) => void;
  depth?: number;
}

function DirectoryTree({
  nodes,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onDoubleClick,
  depth = 0,
}: DirectoryTreeProps) {
  return (
    <div>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isSelected = selectedPath === node.path;

        return (
          <div key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              onDoubleClick={() => onDoubleClick(node.path)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-2 text-left transition-colors",
                "min-h-[40px] text-sm md:min-h-[32px]",
                isSelected ? "bg-primary/20 text-primary" : "hover:bg-accent"
              )}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {/* Expand/collapse */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node);
                }}
                className="hover:bg-muted flex h-5 w-5 flex-shrink-0 items-center justify-center rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="text-muted-foreground h-4 w-4" />
                ) : (
                  <ChevronRight className="text-muted-foreground h-4 w-4" />
                )}
              </button>

              {/* Icon */}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 flex-shrink-0 text-blue-400" />
              ) : (
                <Folder className="h-4 w-4 flex-shrink-0 text-blue-400" />
              )}

              {/* Name */}
              <span className="flex-1 truncate font-medium">{node.name}</span>
            </button>

            {/* Children */}
            {isExpanded && node.children && node.children.length > 0 && (
              <DirectoryTree
                nodes={node.children}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Helper to update node children in tree
function updateNodeChildren(
  nodes: FileNode[],
  targetPath: string,
  children: FileNode[]
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeChildren(node.children, targetPath, children),
      };
    }
    return node;
  });
}
