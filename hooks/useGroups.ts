import { useCallback } from "react";
import type { Group } from "@/lib/db";

interface UseGroupsReturn {
  toggleGroup: (path: string, expanded: boolean) => Promise<void>;
  createGroup: (name: string, parentPath?: string) => Promise<void>;
  deleteGroup: (path: string) => Promise<void>;
}

export function useGroups(
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>,
  fetchSessions: () => Promise<void>
): UseGroupsReturn {

  const toggleGroup = useCallback(async (path: string, expanded: boolean) => {
    try {
      await fetch(`/api/groups/${encodeURIComponent(path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded }),
      });
      setGroups(prev => prev.map(g =>
        g.path === path ? { ...g, expanded } : g
      ));
    } catch (error) {
      console.error("Failed to toggle group:", error);
    }
  }, [setGroups]);

  const createGroup = useCallback(async (name: string, parentPath?: string) => {
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentPath }),
      });
      if (res.ok) {
        await fetchSessions();
      }
    } catch (error) {
      console.error("Failed to create group:", error);
    }
  }, [fetchSessions]);

  const deleteGroup = useCallback(async (path: string) => {
    if (!confirm("Delete this group? Sessions will be moved to parent.")) return;
    try {
      await fetch(`/api/groups/${encodeURIComponent(path)}`, { method: "DELETE" });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
  }, [fetchSessions]);

  return {
    toggleGroup,
    createGroup,
    deleteGroup,
  };
}
