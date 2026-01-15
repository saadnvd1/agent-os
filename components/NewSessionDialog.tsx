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
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  GitBranch,
  Loader2,
  Plus,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { DirectoryPicker } from "./DirectoryPicker";
import type { AgentType } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers";
import type { ProjectWithDevServers } from "@/lib/projects";

const SKIP_PERMISSIONS_KEY = "agentOS:skipPermissions";
const AGENT_TYPE_KEY = "agentOS:defaultAgentType";
const RECENT_DIRS_KEY = "agentOS:recentDirectories";
const USE_TMUX_KEY = "agentOS:useTmux";
const MAX_RECENT_DIRS = 5;

// Random feature name generator
const ADJECTIVES = [
  "swift",
  "blue",
  "bright",
  "calm",
  "cool",
  "dark",
  "fast",
  "gold",
  "green",
  "happy",
  "iron",
  "jade",
  "keen",
  "light",
  "loud",
  "mint",
  "neat",
  "nice",
  "pink",
  "pure",
  "quick",
  "red",
  "sage",
  "sharp",
  "slim",
  "soft",
  "warm",
];
const NOUNS = [
  "falcon",
  "river",
  "storm",
  "tiger",
  "wave",
  "cloud",
  "flame",
  "forest",
  "garden",
  "harbor",
  "island",
  "jungle",
  "lake",
  "meadow",
  "ocean",
  "peak",
  "phoenix",
  "rain",
  "shadow",
  "spark",
  "star",
  "stone",
  "sun",
  "thunder",
  "tree",
  "valley",
  "wind",
  "wolf",
];

function generateFeatureName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

interface GitInfo {
  isGitRepo: boolean;
  branches: string[];
  defaultBranch: string | null;
  currentBranch: string | null;
}

// Agent type options with display names
const AGENT_OPTIONS: {
  value: AgentType;
  label: string;
  description: string;
}[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's CLI" },
  { value: "codex", label: "Codex", description: "OpenAI's CLI" },
  { value: "opencode", label: "OpenCode", description: "Multi-provider CLI" },
  { value: "gemini", label: "Gemini CLI", description: "Google's CLI" },
  { value: "aider", label: "Aider", description: "AI pair programming" },
  { value: "cursor", label: "Cursor CLI", description: "Cursor's AI agent" },
];

interface NewSessionDialogProps {
  open: boolean;
  projects: ProjectWithDevServers[];
  selectedProjectId?: string;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  onCreateProject?: (
    name: string,
    workingDirectory: string,
    agentType: AgentType
  ) => Promise<string | null>;
}

export function NewSessionDialog({
  open,
  projects,
  selectedProjectId,
  onClose,
  onCreated,
  onCreateProject,
}: NewSessionDialogProps) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [agentType, setAgentType] = useState<AgentType>("claude");

  // Inline project creation
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Directory picker
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);

  // Worktree state
  const [useWorktree, setUseWorktree] = useState(false);
  const [featureName, setFeatureName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [checkingGit, setCheckingGit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tmux session option
  const [useTmux, setUseTmux] = useState(true);

  // Recent directories
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

  // Advanced settings collapsed state
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Check if working directory is a git repo
  const checkGitRepo = useCallback(async (path: string) => {
    if (!path || path === "~") {
      setGitInfo(null);
      setUseWorktree(false);
      setFeatureName("");
      return;
    }

    setCheckingGit(true);
    try {
      const res = await fetch("/api/git/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      setGitInfo(data);
      if (data.defaultBranch) {
        setBaseBranch(data.defaultBranch);
      }
      // Auto-enable worktree with random feature name when git repo detected
      if (data.isGitRepo) {
        setUseWorktree(true);
        setFeatureName(generateFeatureName());
      } else {
        setUseWorktree(false);
        setFeatureName("");
      }
    } catch {
      setGitInfo(null);
      setUseWorktree(false);
      setFeatureName("");
    } finally {
      setCheckingGit(false);
    }
  }, []);

  // Debounce git check when working directory changes
  useEffect(() => {
    const timer = setTimeout(() => {
      checkGitRepo(workingDirectory);
    }, 500);
    return () => clearTimeout(timer);
  }, [workingDirectory, checkGitRepo]);

  // Load preferences from localStorage
  useEffect(() => {
    const savedSkipPerms = localStorage.getItem(SKIP_PERMISSIONS_KEY);
    if (savedSkipPerms !== null) {
      setSkipPermissions(savedSkipPerms === "true");
    }
    const savedAgentType = localStorage.getItem(AGENT_TYPE_KEY);
    if (
      savedAgentType &&
      AGENT_OPTIONS.some((opt) => opt.value === savedAgentType)
    ) {
      setAgentType(savedAgentType as AgentType);
    }
    const savedUseTmux = localStorage.getItem(USE_TMUX_KEY);
    if (savedUseTmux !== null) {
      setUseTmux(savedUseTmux === "true");
    }
    // Load recent directories
    try {
      const saved = localStorage.getItem(RECENT_DIRS_KEY);
      if (saved) {
        setRecentDirs(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Initialize project settings when dialog opens with selectedProjectId
  useEffect(() => {
    if (open && selectedProjectId) {
      setProjectId(selectedProjectId);
      // Also apply the project's working directory and agent type
      const project = projects.find((p) => p.id === selectedProjectId);
      if (project && !project.is_uncategorized) {
        setWorkingDirectory(project.working_directory);
        setAgentType(project.agent_type);
      }
    }
  }, [open, selectedProjectId, projects]);

  // Apply project settings when project changes
  const handleProjectChange = useCallback(
    (newProjectId: string | null) => {
      setProjectId(newProjectId);
      if (newProjectId) {
        const project = projects.find((p) => p.id === newProjectId);
        if (project && !project.is_uncategorized) {
          setWorkingDirectory(project.working_directory);
          setAgentType(project.agent_type);
        }
      }
    },
    [projects]
  );

  // Save directory to recent list
  const addRecentDirectory = useCallback((dir: string) => {
    if (!dir || dir === "~") return;
    setRecentDirs((prev) => {
      const filtered = prev.filter((d) => d !== dir);
      const updated = [dir, ...filtered].slice(0, MAX_RECENT_DIRS);
      localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Save skipPermissions preference to localStorage
  const handleSkipPermissionsChange = (checked: boolean) => {
    setSkipPermissions(checked);
    localStorage.setItem(SKIP_PERMISSIONS_KEY, String(checked));
  };

  // Save agentType preference to localStorage
  const handleAgentTypeChange = (value: AgentType) => {
    setAgentType(value);
    localStorage.setItem(AGENT_TYPE_KEY, value);
  };

  // Save useTmux preference to localStorage
  const handleUseTmuxChange = (checked: boolean) => {
    setUseTmux(checked);
    localStorage.setItem(USE_TMUX_KEY, String(checked));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate worktree requirements
    if (useWorktree) {
      if (!featureName.trim()) {
        setError("Feature name is required for worktree");
        return;
      }
      if (!gitInfo?.isGitRepo) {
        setError("Working directory must be a git repository");
        return;
      }
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined, // Let API auto-generate if empty
          workingDirectory,
          projectId,
          agentType,
          // Worktree options
          useWorktree,
          featureName: useWorktree ? featureName.trim() : null,
          baseBranch: useWorktree ? baseBranch : null,
          autoApprove: skipPermissions,
          useTmux,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.session) {
        // Save to recent directories
        addRecentDirectory(workingDirectory);

        setName("");
        setWorkingDirectory("~");
        setProjectId(null);
        setUseWorktree(false);
        setFeatureName("");
        setError(null);
        onCreated(data.session.id);
      }
    } catch (err) {
      console.error("Failed to create session:", err);
      setError("Failed to create session");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (
      !newProjectName.trim() ||
      !onCreateProject ||
      !workingDirectory ||
      workingDirectory === "~"
    )
      return;
    setCreatingProject(true);
    try {
      const newId = await onCreateProject(
        newProjectName.trim(),
        workingDirectory,
        agentType
      );
      if (newId) {
        setProjectId(newId);
        setShowNewProject(false);
        setNewProjectName("");
      }
    } finally {
      setCreatingProject(false);
    }
  };

  const handleClose = () => {
    setName("");
    setWorkingDirectory("~");
    setProjectId(null);
    setUseWorktree(false);
    setFeatureName("");
    setShowNewProject(false);
    setNewProjectName("");
    setError(null);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Session</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Agent</label>
              <Select
                value={agentType}
                onValueChange={(v) => handleAgentTypeChange(v as AgentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="font-medium">{option.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {option.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Name{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-generated if empty"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Working Directory</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={workingDirectory}
                    onChange={(e) => setWorkingDirectory(e.target.value)}
                    placeholder="~/projects/my-app"
                  />
                  {checkingGit && (
                    <div className="absolute top-1/2 right-3 -translate-y-1/2">
                      <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowDirectoryPicker(true)}
                  title="Browse directories"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {gitInfo?.isGitRepo && (
                <p className="text-muted-foreground flex items-center gap-1 text-xs">
                  <GitBranch className="h-3 w-3" />
                  Git repo on {gitInfo.currentBranch}
                </p>
              )}
              {recentDirs.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {recentDirs.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setWorkingDirectory(dir)}
                      className="bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground max-w-[200px] truncate rounded-full px-2 py-0.5 text-xs transition-colors"
                      title={dir}
                    >
                      {dir.replace(/^~\//, "").split("/").pop() || dir}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Worktree option - only show if it's a git repo */}
            {gitInfo?.isGitRepo && (
              <div className="bg-accent/40 space-y-3 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useWorktree"
                    checked={useWorktree}
                    onChange={(e) => setUseWorktree(e.target.checked)}
                    className="border-border bg-background accent-primary h-4 w-4 rounded"
                  />
                  <label
                    htmlFor="useWorktree"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Create isolated worktree
                  </label>
                </div>

                {useWorktree && (
                  <div className="space-y-3 pl-6">
                    <div className="space-y-1">
                      <label className="text-muted-foreground text-xs">
                        Feature Name
                      </label>
                      <Input
                        value={featureName}
                        onChange={(e) => setFeatureName(e.target.value)}
                        placeholder="add-dark-mode"
                        className="h-8 text-sm"
                      />
                      {featureName && (
                        <p className="text-muted-foreground text-xs">
                          Branch: feature/
                          {featureName
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-+|-+$/g, "")
                            .slice(0, 50)}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-muted-foreground text-xs">
                        Base Branch
                      </label>
                      <Select value={baseBranch} onValueChange={setBaseBranch}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {gitInfo.branches.map((branch) => (
                            <SelectItem key={branch} value={branch}>
                              {branch}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Project selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Project</label>
              {showNewProject ? (
                <div className="flex gap-2">
                  <Input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Project name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCreateProject();
                      } else if (e.key === "Escape") {
                        setShowNewProject(false);
                        setNewProjectName("");
                      }
                    }}
                    disabled={creatingProject}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCreateProject}
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
                      setShowNewProject(false);
                      setNewProjectName("");
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
                    onValueChange={(v) =>
                      handleProjectChange(v === "none" ? null : v)
                    }
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
                  {onCreateProject && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowNewProject(true)}
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
                projectId &&
                (() => {
                  const project = projects.find((p) => p.id === projectId);
                  return project && !project.is_uncategorized ? (
                    <p className="text-muted-foreground text-xs">
                      Settings inherited: {project.working_directory},{" "}
                      {project.agent_type}
                    </p>
                  ) : null;
                })()}
            </div>

            {/* Advanced Settings - Collapsible */}
            <div className="border-border rounded-lg border">
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
                />
                Advanced Settings
              </button>
              {advancedOpen && (
                <div className="space-y-3 border-t px-3 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="useTmux"
                      checked={useTmux}
                      onChange={(e) => handleUseTmuxChange(e.target.checked)}
                      className="border-border bg-background accent-primary h-4 w-4 rounded"
                    />
                    <label htmlFor="useTmux" className="cursor-pointer text-sm">
                      Use tmux session
                      <span className="text-muted-foreground ml-1">
                        (enables detach/attach)
                      </span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="skipPermissions"
                      checked={skipPermissions}
                      onChange={(e) =>
                        handleSkipPermissionsChange(e.target.checked)
                      }
                      className="border-border bg-background accent-primary h-4 w-4 rounded"
                    />
                    <label
                      htmlFor="skipPermissions"
                      className="cursor-pointer text-sm"
                    >
                      Auto-approve tool calls
                      <span className="text-muted-foreground ml-1">
                        {(() => {
                          const provider = getProviderDefinition(agentType);
                          if (provider.autoApproveFlag) {
                            return `(${provider.autoApproveFlag})`;
                          }
                          return "(not supported)";
                        })()}
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || (useWorktree && !featureName.trim())}
              >
                {isLoading ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DirectoryPicker
        open={showDirectoryPicker}
        onClose={() => setShowDirectoryPicker(false)}
        onSelect={(path) => setWorkingDirectory(path)}
        initialPath={workingDirectory !== "~" ? workingDirectory : "~"}
      />
    </>
  );
}
