"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useDirectoryFilesQuery } from "@/data/files";
import type { FileNode } from "@/lib/file-utils";

interface UseDirectoryBrowserOptions {
  initialPath?: string;
  /** Filter which files to show (e.g., directories only) */
  filter?: (node: FileNode) => boolean;
}

function sortFiles(files: FileNode[]): FileNode[] {
  return [...files].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function useDirectoryBrowser(options: UseDirectoryBrowserOptions = {}) {
  const { initialPath = "~", filter } = options;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [search, setSearch] = useState("");

  const { data, isPending, error } = useDirectoryFilesQuery(requestedPath);

  // Resolved path for display/navigation (e.g., "~" → "/Users/alice")
  const currentPath = data?.resolvedPath || requestedPath;

  // Filter and sort files from query data
  const files = useMemo(() => {
    if (!data?.files) return [];
    const items = filterRef.current
      ? data.files.filter(filterRef.current)
      : data.files;
    return sortFiles(items);
  }, [data?.files]);

  const filteredFiles = useMemo(
    () =>
      search
        ? files.filter((f) =>
            f.name.toLowerCase().includes(search.toLowerCase())
          )
        : files,
    [files, search]
  );

  const navigateTo = useCallback((path: string) => {
    setSearch("");
    setRequestedPath(path);
  }, []);

  const navigateUp = useCallback(() => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      navigateTo("/" + parts.join("/"));
    } else {
      navigateTo("/");
    }
  }, [currentPath, navigateTo]);

  const navigateHome = useCallback(() => {
    navigateTo("~");
  }, [navigateTo]);

  const pathSegments = useMemo(
    () => currentPath.split("/").filter(Boolean),
    [currentPath]
  );

  return {
    currentPath,
    files,
    filteredFiles,
    loading: isPending,
    error: error?.message || null,
    search,
    setSearch,
    pathSegments,
    navigateTo,
    navigateUp,
    navigateHome,
  };
}
