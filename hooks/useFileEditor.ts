import { useState, useCallback } from "react";
import { getLanguageFromExtension } from "@/lib/file-utils";

export interface OpenFile {
  path: string;
  content: string;
  currentContent: string;
  isBinary: boolean;
  language: string;
}

export interface UseFileEditorReturn {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  loading: boolean;
  saving: boolean;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<{ success: boolean; error?: string }>;
  saveAllFiles: () => Promise<void>;
  isDirty: (path: string) => boolean;
  hasUnsavedChanges: boolean;
  getFile: (path: string) => OpenFile | undefined;
  reset: () => void;
}

export function useFileEditor(): UseFileEditorReturn {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const getFile = useCallback(
    (path: string) => openFiles.find((f) => f.path === path),
    [openFiles]
  );

  const isDirty = useCallback(
    (path: string) => {
      const file = openFiles.find((f) => f.path === path);
      return file ? file.content !== file.currentContent : false;
    },
    [openFiles]
  );

  const hasUnsavedChanges = openFiles.some(
    (f) => f.content !== f.currentContent
  );

  const openFile = useCallback(async (path: string) => {
    // Check if file is already open
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      setActiveFilePath(path);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/files/content?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();

      if (data.error) {
        console.error("Failed to open file:", data.error);
        return;
      }

      const ext = path.split(".").pop() || "";
      const newFile: OpenFile = {
        path: data.path,
        content: data.content,
        currentContent: data.content,
        isBinary: data.isBinary,
        language: getLanguageFromExtension(ext),
      };

      setOpenFiles((prev) => [...prev, newFile]);
      setActiveFilePath(data.path);
    } catch (error) {
      console.error("Failed to open file:", error);
    } finally {
      setLoading(false);
    }
  }, [openFiles]);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const newFiles = prev.filter((f) => f.path !== path);
      // Update active file if we closed the active one
      setActiveFilePath((currentActive) => {
        if (currentActive !== path) return currentActive;
        // Select the next file, or previous, or null
        const closedIndex = prev.findIndex((f) => f.path === path);
        if (newFiles.length === 0) return null;
        if (closedIndex >= newFiles.length) return newFiles[newFiles.length - 1].path;
        return newFiles[closedIndex].path;
      });
      return newFiles;
    });
  }, []);

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, currentContent: content } : f))
    );
  }, []);

  const saveFile = useCallback(
    async (path: string): Promise<{ success: boolean; error?: string }> => {
      const file = openFiles.find((f) => f.path === path);
      if (!file) return { success: false, error: "File not found" };
      if (file.isBinary) return { success: false, error: "Cannot save binary files" };

      setSaving(true);
      try {
        const res = await fetch("/api/files/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: file.currentContent }),
        });
        const data = await res.json();

        if (data.error) {
          return { success: false, error: data.error };
        }

        // Update the saved content to match current
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path ? { ...f, content: f.currentContent } : f
          )
        );

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save",
        };
      } finally {
        setSaving(false);
      }
    },
    [openFiles]
  );

  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = openFiles.filter((f) => f.content !== f.currentContent);
    for (const file of dirtyFiles) {
      await saveFile(file.path);
    }
  }, [openFiles, saveFile]);

  const reset = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
  }, []);

  return {
    openFiles,
    activeFilePath,
    loading,
    saving,
    openFile,
    closeFile,
    setActiveFile: setActiveFilePath,
    updateContent,
    saveFile,
    saveAllFiles,
    isDirty,
    hasUnsavedChanges,
    getFile,
    reset,
  };
}
