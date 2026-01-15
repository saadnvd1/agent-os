import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import type { ProjectWithDevServers } from "@/lib/projects";
import type { AgentType } from "@/lib/providers";

interface ProjectSelectorProps {
  projects: ProjectWithDevServers[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  workingDirectory: string;
  agentType: AgentType;
  showNewProject: boolean;
  onShowNewProjectChange: (show: boolean) => void;
  newProjectName: string;
  onNewProjectNameChange: (name: string) => void;
  creatingProject: boolean;
  onCreateProject: () => void;
  canCreateProject: boolean;
}

export function ProjectSelector({
  projects,
  projectId,
  onProjectChange,
  workingDirectory,
  agentType,
  showNewProject,
  onShowNewProjectChange,
  newProjectName,
  onNewProjectNameChange,
  creatingProject,
  onCreateProject,
  canCreateProject,
}: ProjectSelectorProps) {
  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Project</label>
      {showNewProject ? (
        <div className="flex gap-2">
          <Input
            value={newProjectName}
            onChange={(e) => onNewProjectNameChange(e.target.value)}
            placeholder="Project name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCreateProject();
              } else if (e.key === "Escape") {
                onShowNewProjectChange(false);
                onNewProjectNameChange("");
              }
            }}
            disabled={creatingProject}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateProject}
            disabled={
              !newProjectName.trim() ||
              creatingProject ||
              !workingDirectory ||
              workingDirectory === "~"
            }
          >
            {creatingProject ? "Creating..." : "Create"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onShowNewProjectChange(false);
              onNewProjectNameChange("");
            }}
            disabled={creatingProject}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Select
            value={projectId || "none"}
            onValueChange={(v) => onProjectChange(v === "none" ? null : v)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-muted-foreground">
                  No project (uncategorized)
                </span>
              </SelectItem>
              {projects
                .filter((p) => !p.is_uncategorized)
                .map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {canCreateProject && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onShowNewProjectChange(true)}
              title="Create new project"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      {showNewProject && (
        <p className="text-muted-foreground text-xs">
          {workingDirectory && workingDirectory !== "~"
            ? `New project will use: ${workingDirectory}, ${agentType}`
            : "Enter a working directory above to create a project"}
        </p>
      )}
      {!showNewProject &&
        selectedProject &&
        !selectedProject.is_uncategorized && (
          <p className="text-muted-foreground text-xs">
            Settings inherited: {selectedProject.working_directory},{" "}
            {selectedProject.agent_type}
          </p>
        )}
    </div>
  );
}
