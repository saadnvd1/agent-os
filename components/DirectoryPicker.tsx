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
    if (currentPath === "~" || currentPath === "/" || (homePath && currentPath === homePath)) {
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
        setDirectories((prev) =>
          updateNodeChildren(prev, node.path, dirs)
        );
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
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Directory</DialogTitle>
        </DialogHeader>

        {/* Navigation bar */}
        <div className="flex items-center gap-2 pb-2 border-b">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goHome}
            title="Home"
          >
            <Home className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goUp}
            disabled={currentPath === "~" || currentPath === "/"}
            title="Go up"
          >
            <ChevronUp className="w-4 h-4" />
          </Button>
          <span className="flex-1 text-sm font-mono truncate text-muted-foreground">
            {currentPath}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={selectCurrentDirectory}
            title="Select this directory"
          >
            <FolderInput className="w-4 h-4 mr-1" />
            Use This
          </Button>
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px]">
          {loading && directories.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-500 text-sm">{error}</div>
          ) : directories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
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
                "w-full flex items-center gap-2 px-2 py-2 text-left transition-colors",
                "min-h-[40px] md:min-h-[32px] text-sm",
                isSelected
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-accent"
              )}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {/* Expand/collapse */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node);
                }}
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </button>

              {/* Icon */}
              {isExpanded ? (
                <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
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
