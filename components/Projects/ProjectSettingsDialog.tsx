"use client";

import { useState, useEffect } from "react";
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
import { Plus, Trash2, Loader2, RefreshCw, Server } from "lucide-react";
import { useUpdateProject } from "@/data/projects";
import type { AgentType } from "@/lib/providers";
import type { ProjectWithDevServers, DetectedDevServer } from "@/lib/projects";

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
  isNew?: boolean;
  isDeleted?: boolean;
}

interface ProjectSettingsDialogProps {
  project: ProjectWithDevServers | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function ProjectSettingsDialog({
  project,
  open,
  onClose,
  onSave,
}: ProjectSettingsDialogProps) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [defaultModel, setDefaultModel] = useState("sonnet");
  const [devServers, setDevServers] = useState<DevServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProject = useUpdateProject();

  // Initialize form when project changes
  useEffect(() => {
    if (project) {
      setName(project.name);
      setWorkingDirectory(project.working_directory);
      setAgentType(project.agent_type);
      setDefaultModel(project.default_model);
      setDevServers(
        project.devServers.map((ds) => ({
          id: ds.id,
          name: ds.name,
          type: ds.type,
          command: ds.command,
          port: ds.port || undefined,
          portEnvVar: ds.port_env_var || undefined,
        }))
      );
    }
  }, [project]);

  // Detect dev servers
  const detectDevServers = async () => {
    if (!workingDirectory) return;

    setIsDetecting(true);
    try {
      const res = await fetch("/api/projects/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDirectory }),
      });

      if (res.ok) {
        const data = await res.json();
        const detected = (data.detected || []) as DetectedDevServer[];

        // Add detected servers that don't already exist
        const existingCommands = new Set(devServers.map((ds) => ds.command));
        const newServers = detected
          .filter((d) => !existingCommands.has(d.command))
          .map((d, i) => ({
            id: `new_${Date.now()}_${i}`,
            name: d.name,
            type: d.type,
            command: d.command,
            port: d.port,
            portEnvVar: d.portEnvVar,
            isNew: true,
          }));

        setDevServers((prev) => [...prev, ...newServers]);
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
        id: `new_${Date.now()}`,
        name: "",
        type: "node",
        command: "",
        isNew: true,
      },
    ]);
  };

  // Remove dev server config
  const removeDevServer = (id: string) => {
    setDevServers((prev) =>
      prev.map((ds) =>
        ds.id === id
          ? ds.isNew
            ? null // Remove new items completely
            : { ...ds, isDeleted: true } // Mark existing for deletion
          : ds
      ).filter(Boolean) as DevServerConfig[]
    );
  };

  // Update dev server config
  const updateDevServer = (id: string, updates: Partial<DevServerConfig>) => {
    setDevServers((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, ...updates } : ds))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setError(null);

    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsLoading(true);
    try {
      // Update project settings using mutation (properly invalidates cache)
      await updateProject.mutateAsync({
        projectId: project.id,
        name: name.trim(),
        workingDirectory,
        agentType,
        defaultModel,
      });

      // Handle dev server changes
      for (const ds of devServers) {
        if (ds.isDeleted && !ds.isNew) {
          // Delete existing dev server
          await fetch(`/api/projects/${project.id}/dev-servers/${ds.id}`, {
            method: "DELETE",
          });
        } else if (ds.isNew && !ds.isDeleted && ds.name.trim() && ds.command.trim()) {
          // Create new dev server
          await fetch(`/api/projects/${project.id}/dev-servers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: ds.name.trim(),
              type: ds.type,
              command: ds.command.trim(),
              port: ds.port || undefined,
              portEnvVar: ds.portEnvVar || undefined,
            }),
          });
        } else if (!ds.isNew && !ds.isDeleted) {
          // Update existing dev server
          await fetch(`/api/projects/${project.id}/dev-servers/${ds.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: ds.name.trim(),
              type: ds.type,
              command: ds.command.trim(),
              port: ds.port || undefined,
              portEnvVar: ds.portEnvVar || undefined,
            }),
          });
        }
      }

      handleClose();
      onSave();
    } catch (err) {
      console.error("Failed to update project:", err);
      setError("Failed to update project");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const visibleDevServers = devServers.filter((ds) => !ds.isDeleted);

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Project Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Project Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
            />
          </div>

          {/* Working Directory */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Working Directory</label>
            <Input
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder="~/projects/my-app"
            />
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
                  disabled={isDetecting || !workingDirectory}
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

            {visibleDevServers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No dev servers configured.
              </p>
            ) : (
              <div className="space-y-2">
                {visibleDevServers.map((ds) => (
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
                        placeholder="Port"
                        className="h-8 w-24"
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
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
