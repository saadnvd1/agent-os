"use client";

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
import { Link, GitBranch, FolderPlus, Check } from "lucide-react";
import type { AgentType } from "@/lib/providers";
import {
  AGENT_OPTIONS,
  MODEL_OPTIONS,
  CLONE_STEP,
} from "./NewProjectDialog.types";
import type { NewProjectDialogProps } from "./NewProjectDialog.types";
import { useNewProjectForm } from "./hooks/useNewProjectForm";
import { DevServersSection } from "./DevServersSection";
import { DirectoryField } from "./DirectoryField";
import {
  CreatingOverlay,
  type StepConfig,
} from "@/components/NewSessionDialog/CreatingOverlay";

const cloneSteps: StepConfig[] = [
  { id: CLONE_STEP.CLONING, label: "Cloning repository", icon: GitBranch },
  { id: CLONE_STEP.CREATING, label: "Creating project", icon: FolderPlus },
  { id: CLONE_STEP.DONE, label: "Done", icon: Check },
];

export function NewProjectDialog({
  open,
  mode = "new",
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const form = useNewProjectForm(mode, onClose, onCreated);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && form.handleClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {form.isCloning && (
          <CreatingOverlay
            isWorktree={false}
            step={form.cloneStep}
            steps={cloneSteps}
            hint="This may take a moment depending on the repository size"
          />
        )}
        <DialogHeader>
          <DialogTitle>
            {form.isCloneMode ? "Clone from GitHub" : "New Project"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit} className="space-y-4">
          {/* GitHub URL (clone mode only) */}
          {form.isCloneMode && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Repository URL</label>
              <div className="relative">
                <Input
                  value={form.githubUrl}
                  onChange={(e) => form.handleGithubUrlChange(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  autoFocus
                />
                <Link className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
              </div>
            </div>
          )}

          {/* Project Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Project Name
              {form.isCloneMode && (
                <span className="text-muted-foreground ml-1 font-normal">
                  (optional, derived from URL)
                </span>
              )}
            </label>
            <Input
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              placeholder={
                form.isCloneMode
                  ? "auto-detected from URL"
                  : "my-awesome-project"
              }
              autoFocus={!form.isCloneMode}
            />
          </div>

          {/* Working Directory */}
          <DirectoryField
            label={form.isCloneMode ? "Clone Into" : "Working Directory"}
            value={form.workingDirectory}
            onChange={form.setWorkingDirectory}
            checkingDir={form.checkingDir}
            isGitRepo={form.isGitRepo}
            recentDirs={form.recentDirs}
          />

          {/* Agent Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default Agent</label>
            <Select
              value={form.agentType}
              onValueChange={(v) => form.setAgentType(v as AgentType)}
            >
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
            <Select
              value={form.defaultModel}
              onValueChange={form.setDefaultModel}
            >
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

          {/* Dev Servers (hidden in clone mode) */}
          {!form.isCloneMode && (
            <DevServersSection
              devServers={form.devServers}
              isDetecting={form.isDetecting}
              workingDirectory={form.workingDirectory}
              onDetect={form.detectDevServers}
              onAdd={form.addDevServer}
              onRemove={form.removeDevServer}
              onUpdate={form.updateDevServer}
            />
          )}

          {form.error && <p className="text-sm text-red-500">{form.error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={form.handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.isPending || form.isCloning}>
              {form.isCloning
                ? "Cloning..."
                : form.isPending
                  ? "Creating..."
                  : form.isCloneMode
                    ? "Clone & Create"
                    : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
