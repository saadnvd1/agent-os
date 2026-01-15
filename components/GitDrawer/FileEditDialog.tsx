"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Save,
  Loader2,
  Copy,
  Check,
  File,
  Plus,
  Minus,
  Edit3,
} from "lucide-react";
import { DiffEditor, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GitFile } from "@/lib/git-status";

interface FileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
  file: GitFile;
  allFiles: GitFile[];
  onFileSelect: (file: GitFile) => void;
  onStage: (file: GitFile) => void;
  onUnstage: (file: GitFile) => void;
  onSave: () => void;
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    sh: "shell",
    bash: "shell",
    yml: "yaml",
    yaml: "yaml",
    xml: "xml",
    sql: "sql",
  };
  return map[ext] || "plaintext";
}

function getStatusIcon(status: GitFile["status"]) {
  switch (status) {
    case "modified":
      return <Edit3 className="h-3 w-3 text-yellow-500" />;
    case "added":
    case "untracked":
      return <Plus className="h-3 w-3 text-green-500" />;
    case "deleted":
      return <Minus className="h-3 w-3 text-red-500" />;
    default:
      return <File className="h-3 w-3" />;
  }
}

export function FileEditDialog({
  open,
  onOpenChange,
  workingDirectory,
  file,
  allFiles,
  onFileSelect,
  onStage,
  onUnstage,
  onSave,
}: FileEditDialogProps) {
  const [originalContent, setOriginalContent] = useState("");
  const [modifiedContent, setModifiedContent] = useState("");
  const [initialModified, setInitialModified] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const filePath = `${workingDirectory}/${file.path}`;
  const fileName = file.path.split("/").pop() || file.path;
  const hasChanges = modifiedContent !== initialModified;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`).then(
        (r) => r.json()
      ),
      fetch(
        `/api/git/file-content?path=${encodeURIComponent(workingDirectory)}&file=${encodeURIComponent(file.path)}`
      ).then((r) => r.json()),
    ])
      .then(([modData, origData]) => {
        if (modData.error) {
          setError(modData.error);
          return;
        }
        setModifiedContent(modData.content || "");
        setInitialModified(modData.content || "");
        setOriginalContent(
          origData.error || file.status === "untracked"
            ? ""
            : origData.content || ""
        );
      })
      .catch(() => setError("Failed to load file"))
      .finally(() => setLoading(false));
  }, [open, filePath, workingDirectory, file.path, file.status]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/files/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: modifiedContent }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setInitialModified(modifiedContent);
        onSave();
      }
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges && !confirm("Discard unsaved changes?")) return;
    onOpenChange(false);
  };

  const handleEditorMount = useCallback((ed: editor.IStandaloneDiffEditor) => {
    editorRef.current = ed;
    ed.getModifiedEditor().onDidChangeModelContent(() => {
      setModifiedContent(ed.getModifiedEditor().getValue() ?? "");
    });
  }, []);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    monaco.editor.defineTheme("agentOsDiff", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0a0a0a",
        "editorGutter.background": "#0a0a0a",
        "diffEditor.insertedTextBackground": "#22c55e25",
        "diffEditor.insertedLineBackground": "#22c55e15",
        "diffEditor.removedTextBackground": "#ef444425",
        "diffEditor.removedLineBackground": "#ef444415",
        "diffEditor.unchangedRegionBackground": "#141414",
      },
    });
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-background m-auto flex h-[90vh] w-[95vw] max-w-7xl overflow-hidden rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left sidebar - file list */}
        <div className="flex w-[280px] flex-shrink-0 flex-col border-r">
          <div className="text-muted-foreground border-b px-3 py-2 text-xs font-medium">
            CHANGED FILES
          </div>
          <div className="flex-1 overflow-y-auto">
            {allFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => onFileSelect(f)}
                className={cn(
                  "hover:bg-accent/50 flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  f.path === file.path && "bg-accent"
                )}
              >
                {getStatusIcon(f.status)}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{f.path.split("/").pop()}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {f.status} {f.staged && "• staged"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right side - editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-sm">{fileName}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(file.path);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              {hasChanges && (
                <span className="rounded bg-yellow-500/20 px-1.5 text-xs text-yellow-500">
                  Unsaved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => (file.staged ? onUnstage(file) : onStage(file))}
              >
                {file.staged ? (
                  <>
                    <Minus className="mr-1 h-3 w-3" />
                    Unstage
                  </>
                ) : (
                  <>
                    <Plus className="mr-1 h-3 w-3" />
                    Stage
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges || saving}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3 w-3" />
                )}
                Save
              </Button>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 px-4 py-2 text-sm text-red-500">
              {error}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              </div>
            ) : (
              <DiffEditor
                original={originalContent}
                modified={modifiedContent}
                language={getLanguageFromPath(file.path)}
                theme="agentOsDiff"
                onMount={handleEditorMount}
                beforeMount={handleBeforeMount}
                options={{
                  readOnly: false,
                  originalEditable: false,
                  renderSideBySide: false,
                  fontSize: 13,
                  lineHeight: 20,
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  hideUnchangedRegions: {
                    enabled: true,
                    revealLineCount: 3,
                    minimumLineCount: 5,
                  },
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                  padding: { top: 8, bottom: 8 },
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
