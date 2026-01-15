import { useState, useEffect, useCallback } from "react";
import type { AgentType } from "@/lib/providers";
import type { ProjectWithDevServers } from "@/lib/projects";
import { setPendingPrompt } from "@/stores/initialPrompt";
import {
  type GitInfo,
  type NewSessionFormState,
  SKIP_PERMISSIONS_KEY,
  AGENT_TYPE_KEY,
  RECENT_DIRS_KEY,
  USE_TMUX_KEY,
  MAX_RECENT_DIRS,
  AGENT_OPTIONS,
  generateFeatureName,
} from "../NewSessionDialog.types";

interface UseNewSessionFormOptions {
  open: boolean;
  projects: ProjectWithDevServers[];
  selectedProjectId?: string;
  onCreated: (sessionId: string) => void;
  onClose: () => void;
  onCreateProject?: (
    name: string,
    workingDirectory: string,
    agentType: AgentType
  ) => Promise<string | null>;
}

export function useNewSessionForm({
  open,
  projects,
  selectedProjectId,
  onCreated,
  onClose,
  onCreateProject,
}: UseNewSessionFormOptions) {
  // Form state
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [useTmux, setUseTmux] = useState(true);
  const [initialPrompt, setInitialPrompt] = useState("");

  // Worktree state
  const [useWorktree, setUseWorktree] = useState(false);
  const [featureName, setFeatureName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [checkingGit, setCheckingGit] = useState(false);

  // UI state
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);

  // Submission state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent directories
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

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

  // Debounce git check
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
    try {
      const saved = localStorage.getItem(RECENT_DIRS_KEY);
      if (saved) {
        setRecentDirs(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Initialize from selectedProjectId when dialog opens
  useEffect(() => {
    if (open && selectedProjectId) {
      setProjectId(selectedProjectId);
      const project = projects.find((p) => p.id === selectedProjectId);
      if (project && !project.is_uncategorized) {
        setWorkingDirectory(project.working_directory);
        setAgentType(project.agent_type);
      }
    }
  }, [open, selectedProjectId, projects]);

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

  // Handlers
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

  const handleSkipPermissionsChange = (checked: boolean) => {
    setSkipPermissions(checked);
    localStorage.setItem(SKIP_PERMISSIONS_KEY, String(checked));
  };

  const handleAgentTypeChange = (value: AgentType) => {
    setAgentType(value);
    localStorage.setItem(AGENT_TYPE_KEY, value);
  };

  const handleUseTmuxChange = (checked: boolean) => {
    setUseTmux(checked);
    localStorage.setItem(USE_TMUX_KEY, String(checked));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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
          name: name.trim() || undefined,
          workingDirectory,
          projectId,
          agentType,
          useWorktree,
          featureName: useWorktree ? featureName.trim() : null,
          baseBranch: useWorktree ? baseBranch : null,
          autoApprove: skipPermissions,
          useTmux,
          initialPrompt: initialPrompt.trim() || null,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.session) {
        if (data.initialPrompt) {
          setPendingPrompt(data.session.id, data.initialPrompt);
        }
        addRecentDirectory(workingDirectory);
        resetForm();
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

  const resetForm = () => {
    setName("");
    setWorkingDirectory("~");
    setProjectId(null);
    setUseWorktree(false);
    setFeatureName("");
    setInitialPrompt("");
    setShowNewProject(false);
    setNewProjectName("");
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return {
    // Form values
    name,
    setName,
    workingDirectory,
    setWorkingDirectory,
    projectId,
    agentType,
    skipPermissions,
    useTmux,
    initialPrompt,
    setInitialPrompt,
    // Worktree
    useWorktree,
    setUseWorktree,
    featureName,
    setFeatureName,
    baseBranch,
    setBaseBranch,
    gitInfo,
    checkingGit,
    // UI
    showNewProject,
    setShowNewProject,
    newProjectName,
    setNewProjectName,
    creatingProject,
    advancedOpen,
    setAdvancedOpen,
    showDirectoryPicker,
    setShowDirectoryPicker,
    // Submission
    isLoading,
    error,
    // Recent
    recentDirs,
    // Handlers
    handleProjectChange,
    handleSkipPermissionsChange,
    handleAgentTypeChange,
    handleUseTmuxChange,
    handleSubmit,
    handleCreateProject,
    handleClose,
  };
}
