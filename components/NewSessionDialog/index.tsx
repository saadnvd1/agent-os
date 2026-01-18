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
import { Textarea } from "@/components/ui/textarea";
import { DirectoryPicker } from "@/components/DirectoryPicker";

import { useNewSessionForm } from "./hooks/useNewSessionForm";
import { AgentSelector } from "./AgentSelector";
import { WorkingDirectoryInput } from "./WorkingDirectoryInput";
import { WorktreeSection } from "./WorktreeSection";
import { ProjectSelector } from "./ProjectSelector";
import { AdvancedSettings } from "./AdvancedSettings";
import { CreatingOverlay } from "./CreatingOverlay";
import type { NewSessionDialogProps } from "./NewSessionDialog.types";

export function NewSessionDialog({
  open,
  projects,
  selectedProjectId,
  onClose,
  onCreated,
  onCreateProject,
}: NewSessionDialogProps) {
  const form = useNewSessionForm({
    open,
    projects,
    selectedProjectId,
    onCreated,
    onClose,
    onCreateProject,
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && !form.isLoading && form.handleClose()}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {/* Loading overlay */}
          {form.isLoading && (
            <CreatingOverlay
              isWorktree={form.useWorktree}
              step={form.creationStep}
            />
          )}
          <DialogHeader>
            <DialogTitle>New Session</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit} className="space-y-4">
            <AgentSelector
              value={form.agentType}
              onChange={form.handleAgentTypeChange}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Name{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                placeholder="Auto-generated if empty"
                autoFocus
              />
            </div>

            <WorkingDirectoryInput
              value={form.workingDirectory}
              onChange={form.setWorkingDirectory}
              gitInfo={form.gitInfo}
              checkingGit={form.checkingGit}
              recentDirs={form.recentDirs}
              onBrowse={() => form.setShowDirectoryPicker(true)}
            />

            {form.gitInfo?.isGitRepo && (
              <WorktreeSection
                gitInfo={form.gitInfo}
                useWorktree={form.useWorktree}
                onUseWorktreeChange={form.setUseWorktree}
                featureName={form.featureName}
                onFeatureNameChange={form.setFeatureName}
                baseBranch={form.baseBranch}
                onBaseBranchChange={form.setBaseBranch}
              />
            )}

            <ProjectSelector
              projects={projects}
              projectId={form.projectId}
              onProjectChange={form.handleProjectChange}
              workingDirectory={form.workingDirectory}
              agentType={form.agentType}
              showNewProject={form.showNewProject}
              onShowNewProjectChange={form.setShowNewProject}
              newProjectName={form.newProjectName}
              onNewProjectNameChange={form.setNewProjectName}
              creatingProject={form.creatingProject}
              onCreateProject={form.handleCreateProject}
              canCreateProject={!!onCreateProject}
            />

            {/* Initial Prompt */}
            <div className="space-y-2">
              <label htmlFor="initialPrompt" className="text-sm font-medium">
                Initial Prompt{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Textarea
                id="initialPrompt"
                value={form.initialPrompt}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  form.setInitialPrompt(e.target.value)
                }
                placeholder="Enter a prompt to send when the session starts..."
                className="min-h-[80px] resize-none text-sm"
                rows={3}
              />
            </div>

            <AdvancedSettings
              open={form.advancedOpen}
              onOpenChange={form.setAdvancedOpen}
              agentType={form.agentType}
              useTmux={form.useTmux}
              onUseTmuxChange={form.handleUseTmuxChange}
              skipPermissions={form.skipPermissions}
              onSkipPermissionsChange={form.handleSkipPermissionsChange}
            />

            {form.error && <p className="text-sm text-red-500">{form.error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={form.handleClose}
                disabled={form.isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  form.isLoading ||
                  (form.useWorktree && !form.featureName.trim())
                }
              >
                {form.isLoading ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DirectoryPicker
        open={form.showDirectoryPicker}
        onClose={() => form.setShowDirectoryPicker(false)}
        onSelect={(path) => form.setWorkingDirectory(path)}
        initialPath={
          form.workingDirectory !== "~" ? form.workingDirectory : "~"
        }
      />
    </>
  );
}
