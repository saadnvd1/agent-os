"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileTabs } from "./FileTabs";
import type { UseFileEditorReturn } from "@/hooks/useFileEditor";
import { useViewport } from "@/hooks/useViewport";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  Folder,
  Save,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FileNode } from "@/lib/file-utils";
import type { OpenFile } from "@/hooks/useFileEditor";

interface FileExplorerProps {
  workingDirectory: string;
  fileEditor: UseFileEditorReturn;
}

export function FileExplorer({ workingDirectory, fileEditor }: FileExplorerProps) {
  const { isMobile, isHydrated } = useViewport();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  const {
    openFiles,
    activeFilePath,
    loading: fileLoading,
    saving,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    isDirty,
    getFile,
  } = fileEditor;

  // Load directory contents
  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files?path=${encodeURIComponent(workingDirectory)}`
        );
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setFiles(data.files || []);
        }
      } catch {
        setError("Failed to load directory");
      } finally {
        setLoading(false);
      }
    };
    loadFiles();
  }, [workingDirectory]);

  const handleFileClick = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      if (isDirty(path)) {
        setPendingClose(path);
      } else {
        closeFile(path);
      }
    },
    [isDirty, closeFile]
  );

  const handleConfirmClose = useCallback(async () => {
    if (!pendingClose) return;
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, closeFile]);

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingClose) return;
    await saveFile(pendingClose);
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, saveFile, closeFile]);

  const handleSave = useCallback(async () => {
    if (activeFilePath) {
      await saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  const activeFile = activeFilePath ? getFile(activeFilePath) : undefined;

  // Loading state before hydration
  if (!isHydrated) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Mobile layout: full-screen tree OR full-screen editor
  if (isMobile) {
    return (
      <MobileFileExplorer
        files={files}
        loading={loading}
        error={error}
        fileLoading={fileLoading}
        workingDirectory={workingDirectory}
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        activeFile={activeFile}
        saving={saving}
        onFileClick={handleFileClick}
        onSelectTab={setActiveFile}
        onCloseTab={handleCloseFile}
        onSave={handleSave}
        onBack={() => setActiveFile(null as unknown as string)}
        isDirty={isDirty}
        updateContent={updateContent}
        pendingClose={pendingClose}
        onCancelClose={() => setPendingClose(null)}
        onConfirmClose={handleConfirmClose}
        onSaveAndClose={handleSaveAndClose}
      />
    );
  }

  // Desktop layout: side-by-side tree + editor
  return (
    <DesktopFileExplorer
      files={files}
      loading={loading}
      error={error}
      fileLoading={fileLoading}
      workingDirectory={workingDirectory}
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      activeFile={activeFile}
      saving={saving}
      onFileClick={handleFileClick}
      onSelectTab={setActiveFile}
      onCloseTab={handleCloseFile}
      onSave={handleSave}
      isDirty={isDirty}
      updateContent={updateContent}
      pendingClose={pendingClose}
      onCancelClose={() => setPendingClose(null)}
      onConfirmClose={handleConfirmClose}
      onSaveAndClose={handleSaveAndClose}
    />
  );
}

// Desktop: Side-by-side tree + editor
interface DesktopFileExplorerProps {
  files: FileNode[];
  loading: boolean;
  error: string | null;
  fileLoading: boolean;
  workingDirectory: string;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  activeFile: OpenFile | undefined;
  saving: boolean;
  onFileClick: (path: string) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  isDirty: (path: string) => boolean;
  updateContent: (path: string, content: string) => void;
  pendingClose: string | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  onSaveAndClose: () => void;
}

function DesktopFileExplorer({
  files,
  loading,
  error,
  fileLoading,
  workingDirectory,
  openFiles,
  activeFilePath,
  activeFile,
  saving,
  onFileClick,
  onSelectTab,
  onCloseTab,
  onSave,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
}: DesktopFileExplorerProps) {
  const [treeWidth, setTreeWidth] = useState(280);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setTreeWidth(Math.max(200, Math.min(500, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full bg-background flex">
      {/* File tree panel */}
      <div className="h-full flex flex-col" style={{ width: treeWidth }}>
        <div className="flex items-center gap-2 p-3">
          <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <p className="text-sm font-medium truncate flex-1">Files</p>
        </div>
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
              onFileClick={onFileClick}
            />
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1 cursor-col-resize bg-muted/50 hover:bg-primary/50 active:bg-primary transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
      />

      {/* Editor panel */}
      <div className="h-full flex-1 flex flex-col min-w-0 bg-muted/20">
        {/* Tabs */}
        {openFiles.length > 0 && (
          <div className="bg-background/50">
            <FileTabs
              files={openFiles}
              activeFilePath={activeFilePath}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              isDirty={isDirty}
            />
          </div>
        )}

        {/* Editor or empty state */}
        <div className="flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeFile ? (
            <FileEditor
              content={activeFile.currentContent}
              language={activeFile.language}
              isBinary={activeFile.isBinary}
              onChange={(content) =>
                updateContent(activeFile.path, content)
              }
              onSave={onSave}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <Folder className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-sm">Select a file to edit</p>
            </div>
          )}
        </div>
      </div>

      {/* Unsaved changes dialog */}
      <UnsavedChangesDialog
        open={!!pendingClose}
        fileName={pendingClose?.split("/").pop() || ""}
        onCancel={onCancelClose}
        onDiscard={onConfirmClose}
        onSave={onSaveAndClose}
      />
    </div>
  );
}

// Mobile: Full-screen tree OR full-screen editor
interface MobileFileExplorerProps extends DesktopFileExplorerProps {
  onBack: () => void;
}

function MobileFileExplorer({
  files,
  loading,
  error,
  fileLoading,
  workingDirectory,
  openFiles,
  activeFilePath,
  activeFile,
  saving,
  onFileClick,
  onSelectTab,
  onCloseTab,
  onSave,
  onBack,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
}: MobileFileExplorerProps) {
  // Show editor when a file is active
  if (activeFile) {
    const isCurrentDirty = activeFilePath ? isDirty(activeFilePath) : false;

    return (
      <div className="h-full w-full flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-2 p-2 bg-muted/30">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <FileTabs
              files={openFiles}
              activeFilePath={activeFilePath}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              isDirty={isDirty}
            />
          </div>
          {isCurrentDirty && (
            <Button
              variant="default"
              size="sm"
              onClick={onSave}
              disabled={saving}
              className="flex-shrink-0"
            >
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <FileEditor
              content={activeFile.currentContent}
              language={activeFile.language}
              isBinary={activeFile.isBinary}
              onChange={(content) => updateContent(activeFile.path, content)}
              onSave={onSave}
            />
          )}
        </div>

        {/* Unsaved changes dialog */}
        <UnsavedChangesDialog
          open={!!pendingClose}
          fileName={pendingClose?.split("/").pop() || ""}
          onCancel={onCancelClose}
          onDiscard={onConfirmClose}
          onSave={onSaveAndClose}
        />
      </div>
    );
  }

  // Show file tree
  return (
    <div className="h-full w-full flex flex-col bg-background">
      <div className="flex items-center gap-2 p-3">
        <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">Files</p>
          <p className="text-xs text-muted-foreground truncate">
            {workingDirectory}
          </p>
        </div>
      </div>

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
            onFileClick={onFileClick}
          />
        )}
      </div>

      {fileLoading && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}

// Unsaved changes confirmation dialog
interface UnsavedChangesDialogProps {
  open: boolean;
  fileName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

function UnsavedChangesDialog({
  open,
  fileName,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            {fileName} has unsaved changes. What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
