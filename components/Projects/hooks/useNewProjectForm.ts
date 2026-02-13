import { useState, useEffect, useCallback } from "react";
import type { AgentType } from "@/lib/providers";
import { useCreateProject, useDetectDevServers } from "@/data/projects";
import { useGitCheck, useCloneRepo } from "@/data/git/queries";
import {
  RECENT_DIRS_KEY,
  MAX_RECENT_DIRS,
  CLONE_STEP,
  extractRepoName,
  type CloneStep,
  type DevServerConfig,
} from "../NewProjectDialog.types";

export function useNewProjectForm(
  mode: "new" | "clone",
  onClose: () => void,
  onCreated: (projectId: string) => void
) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [debouncedDir, setDebouncedDir] = useState("~");
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [defaultModel, setDefaultModel] = useState("opus");
  const [devServers, setDevServers] = useState<DevServerConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [cloneStep, setCloneStep] = useState<CloneStep>(CLONE_STEP.IDLE);

  const isCloneMode = mode === "clone";

  // React Query hooks
  const createProject = useCreateProject();
  const cloneRepo = useCloneRepo();
  const detectDevServers = useDetectDevServers();

  const gitCheck = useGitCheck(debouncedDir);

  // Debounce directory for git check query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDir(workingDirectory), 500);
    return () => clearTimeout(timer);
  }, [workingDirectory]);

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

  // Dev server management
  const handleDetectDevServers = () => {
    if (!workingDirectory || workingDirectory === "~") return;

    detectDevServers.mutate(workingDirectory, {
      onSuccess: (detected) => {
        const configs = detected.map((d, i) => ({
          id: `ds_${Date.now()}_${i}`,
          name: d.name,
          type: d.type,
          command: d.command,
          port: d.port,
          portEnvVar: d.portEnvVar,
        }));
        setDevServers(configs);
      },
    });
  };

  const addDevServer = () => {
    setDevServers((prev) => [
      ...prev,
      { id: `ds_${Date.now()}`, name: "", type: "node", command: "" },
    ]);
  };

  const removeDevServer = (id: string) => {
    setDevServers((prev) => prev.filter((ds) => ds.id !== id));
  };

  const updateDevServer = (id: string, updates: Partial<DevServerConfig>) => {
    setDevServers((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, ...updates } : ds))
    );
  };

  const handleClose = () => {
    setName("");
    setWorkingDirectory("~");
    setAgentType("claude");
    setDefaultModel("opus");
    setDevServers([]);
    setGithubUrl("");
    setCloneStep(CLONE_STEP.IDLE);
    setError(null);
    onClose();
  };

  const handleGithubUrlChange = (value: string) => {
    setGithubUrl(value);
    const repoName = extractRepoName(value);
    if (repoName && !name) {
      setName(repoName);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!workingDirectory || (!isCloneMode && workingDirectory === "~")) {
      setError("Working directory is required");
      return;
    }

    if (isCloneMode) {
      if (!githubUrl.trim()) {
        setError("GitHub repository URL is required");
        return;
      }

      const projectName =
        name.trim() || extractRepoName(githubUrl.trim()) || "project";

      setCloneStep(CLONE_STEP.CLONING);
      cloneRepo.mutate(
        { url: githubUrl.trim(), directory: workingDirectory },
        {
          onSuccess: (cloneData) => {
            setCloneStep(CLONE_STEP.CREATING);
            createProject.mutate(
              {
                name: projectName,
                workingDirectory: cloneData.path,
                agentType,
                defaultModel,
                devServers: [],
              },
              {
                onSuccess: (data) => {
                  setCloneStep(CLONE_STEP.DONE);
                  addRecentDirectory(cloneData.path);
                  setTimeout(() => {
                    handleClose();
                    onCreated(data.project.id);
                  }, 300);
                },
                onError: (err) => {
                  setCloneStep(CLONE_STEP.IDLE);
                  setError(err.message || "Failed to create project");
                },
              }
            );
          },
          onError: (err) => {
            setCloneStep(CLONE_STEP.IDLE);
            setError(err.message || "Failed to clone repository");
          },
        }
      );
      return;
    }

    // Normal mode
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

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

  return {
    // State
    name,
    setName,
    workingDirectory,
    setWorkingDirectory,
    agentType,
    setAgentType,
    defaultModel,
    setDefaultModel,
    devServers,
    isDetecting: detectDevServers.isPending,
    error,
    recentDirs,
    isGitRepo: gitCheck.data?.isGitRepo ?? false,
    checkingDir: gitCheck.isFetching,
    githubUrl,
    isCloning: cloneStep !== CLONE_STEP.IDLE,
    cloneStep,
    isCloneMode,
    isPending: createProject.isPending,

    // Actions
    handleGithubUrlChange,
    detectDevServers: handleDetectDevServers,
    addDevServer,
    removeDevServer,
    updateDevServer,
    handleSubmit,
    handleClose,
  };
}
