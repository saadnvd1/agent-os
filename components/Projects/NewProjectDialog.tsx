"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, GitBranch, RefreshCw, Server } from "lucide-react";
import type { AgentType } from "@/lib/providers";
import type { DetectedDevServer } from "@/lib/projects";
import { useCreateProject } from "@/data/projects";

const RECENT_DIRS_KEY = "agentOS:recentDirectories";
const MAX_RECENT_DIRS = 5;

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "aider", label: "Aider" },
  { value: "cursor", label: "Cursor CLI" },
];

const MODEL_OPTIONS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

interface DevServerConfig {
  id: string;
  name: string;
  type: "node" | "docker";
  command: string;
  port?: number;
  portEnvVar?: string;
}

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [defaultModel, setDefaultModel] = useState("sonnet");
  const [devServers, setDevServers] = useState<DevServerConfig[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [checkingDir, setCheckingDir] = useState(false);

  const createProject = useCreateProject();

  // Load recent directories
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_DIRS_KEY);
      if (saved) {
        setRecentDirs(JSON.parse(saved));
      }
    } catch {
      // Ignore
    }
  }, []);

  // Check if directory exists and is a git repo
  const checkDirectory = useCallback(async (path: string) => {
    if (!path || path === "~") {
      setIsGitRepo(false);
      return;
    }

    setCheckingDir(true);
    try {
      const res = await fetch("/api/git/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      setIsGitRepo(data.isGitRepo);
    } catch {
      setIsGitRepo(false);
    } finally {
      setCheckingDir(false);
    }
  }, []);

  // Debounce directory check
  useEffect(() => {
    const timer = setTimeout(() => {
      checkDirectory(workingDirectory);
    }, 500);
    return () => clearTimeout(timer);
  }, [workingDirectory, checkDirectory]);

  // Detect dev servers
  const detectDevServers = async () => {
    if (!workingDirectory || workingDirectory === "~") return;

    setIsDetecting(true);
    try {
      const res = await fetch(
        `/api/projects/uncategorized/detect?workingDirectory=${encodeURIComponent(workingDirectory)}`
      );

      // Fall back to direct API call with working directory in body
      const detectRes = await fetch("/api/projects/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDirectory }),
      });

      if (detectRes.ok) {
        const data = await detectRes.json();
        const detected = (data.detected || []) as DetectedDevServer[];

        // Convert to config format
        const configs = detected.map((d, i) => ({
          id: `ds_${Date.now()}_${i}`,
          name: d.name,
          type: d.type,
          command: d.command,
          port: d.port,
          portEnvVar: d.portEnvVar,
        }));

        setDevServers(configs);
      }
    } catch (err) {
      console.error("Failed to detect dev servers:", err);
    } finally {
      setIsDetecting(false);
    }
  };

  // Add new dev server config
  const addDevServer = () => {
    setDevServers((prev) => [
      ...prev,
      {
        id: `ds_${Date.now()}`,
        name: "",
        type: "node",
        command: "",
      },
    ]);
  };

  // Remove dev server config
  const removeDevServer = (id: string) => {
    setDevServers((prev) => prev.filter((ds) => ds.id !== id));
  };

  // Update dev server config
  const updateDevServer = (id: string, updates: Partial<DevServerConfig>) => {
    setDevServers((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, ...updates } : ds))
    );
  };

  // Save recent directory
  const addRecentDirectory = useCallback((dir: string) => {
    if (!dir || dir === "~") return;
    setRecentDirs((prev) => {
      const filtered = prev.filter((d) => d !== dir);
      const updated = [dir, ...filtered].slice(0, MAX_RECENT_DIRS);
      localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    if (!workingDirectory || workingDirectory === "~") {
      setError("Working directory is required");
      return;
    }

    // Validate dev servers
    const validDevServers = devServers.filter(
      (ds) => ds.name.trim() && ds.command.trim()
    );

    createProject.mutate(
      {
        name: name.trim(),
        workingDirectory,
        agentType,
        defaultModel,
        devServers: validDevServers.map((ds) => ({
          name: ds.name.trim(),
          type: ds.type,
          command: ds.command.trim(),
          port: ds.port || undefined,
          portEnvVar: ds.portEnvVar || undefined,
        })),
      },
      {
        onSuccess: (data) => {
          addRecentDirectory(workingDirectory);
          handleClose();
          onCreated(data.project.id);
        },
        onError: (err) => {
          setError(err.message || "Failed to create project");
        },
      }
    );
  };

  const handleClose = () => {
    setName("");
    setWorkingDirectory("~");
    setAgentType("claude");
    setDefaultModel("sonnet");
    setDevServers([]);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Project Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Project Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              autoFocus
            />
          </div>

          {/* Working Directory */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Working Directory</label>
            <div className="relative">
              <Input
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="~/projects/my-app"
              />
              {checkingDir && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            {isGitRepo && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                Git repository
              </p>
            )}
            {recentDirs.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {recentDirs.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setWorkingDirectory(dir)}
                    className="text-xs px-2 py-0.5 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
                    title={dir}
                  >
                    {dir.replace(/^~\//, "").split("/").pop() || dir}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Agent Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default Agent</label>
            <Select value={agentType} onValueChange={(v) => setAgentType(v as AgentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Default Model */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default Model</label>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dev Servers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4" />
                Dev Servers
              </label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={detectDevServers}
                  disabled={isDetecting || !workingDirectory || workingDirectory === "~"}
                >
                  {isDetecting ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1" />
                  )}
                  Detect
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={addDevServer}>
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {devServers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No dev servers configured. Click Detect to auto-find or Add to configure manually.
              </p>
            ) : (
              <div className="space-y-2">
                {devServers.map((ds) => (
                  <div
                    key={ds.id}
                    className="p-3 rounded-lg bg-accent/30 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={ds.name}
                        onChange={(e) =>
                          updateDevServer(ds.id, { name: e.target.value })
                        }
                        placeholder="Server name"
                        className="h-8 flex-1"
                      />
                      <Select
                        value={ds.type}
                        onValueChange={(v) =>
                          updateDevServer(ds.id, { type: v as "node" | "docker" })
                        }
                      >
                        <SelectTrigger className="h-8 w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="node">Node</SelectItem>
                          <SelectItem value="docker">Docker</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeDevServer(ds.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <Input
                      value={ds.command}
                      onChange={(e) =>
                        updateDevServer(ds.id, { command: e.target.value })
                      }
                      placeholder={ds.type === "docker" ? "Service name" : "npm run dev"}
                      className="h-8"
                    />
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={ds.port || ""}
                        onChange={(e) =>
                          updateDevServer(ds.id, {
                            port: e.target.value ? parseInt(e.target.value) : undefined,
                          })
                        }
                        placeholder="Port (e.g., 3000)"
                        className="h-8 w-32"
                      />
                      <Input
                        value={ds.portEnvVar || ""}
                        onChange={(e) =>
                          updateDevServer(ds.id, { portEnvVar: e.target.value })
                        }
                        placeholder="Port env var (e.g., PORT)"
                        className="h-8 flex-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
