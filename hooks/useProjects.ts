import { useState, useCallback } from "react";
import type { ProjectWithDevServers } from "@/lib/projects";

interface UseProjectsReturn {
  projects: ProjectWithDevServers[];
  fetchProjects: () => Promise<void>;
  toggleProject: (projectId: string, expanded: boolean) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  setProjects: React.Dispatch<React.SetStateAction<ProjectWithDevServers[]>>;
}

export function useProjects(onProjectChange?: () => Promise<void>): UseProjectsReturn {
  const [projects, setProjects] = useState<ProjectWithDevServers[]>([]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (error instanceof TypeError && error.message === "Failed to fetch") return;
      console.error("Failed to fetch projects:", error);
    }
  }, []);

  const toggleProject = useCallback(async (projectId: string, expanded: boolean) => {
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded }),
      });
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, expanded } : p
      ));
    } catch (error) {
      console.error("Failed to toggle project:", error);
    }
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    if (!confirm("Delete this project? Sessions will be moved to Uncategorized.")) return;
    try {
      await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      await fetchProjects();
      if (onProjectChange) await onProjectChange();
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  }, [fetchProjects, onProjectChange]);

  const renameProject = useCallback(async (projectId: string, newName: string) => {
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      await fetchProjects();
    } catch (error) {
      console.error("Failed to rename project:", error);
    }
  }, [fetchProjects]);

  return {
    projects,
    fetchProjects,
    toggleProject,
    deleteProject,
    renameProject,
    setProjects,
  };
}
