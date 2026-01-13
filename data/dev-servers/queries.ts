import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DevServer } from "@/lib/db";
import { devServerKeys } from "./keys";

async function fetchDevServers(): Promise<DevServer[]> {
  const res = await fetch("/api/dev-servers");
  if (!res.ok) throw new Error("Failed to fetch dev servers");
  const data = await res.json();
  return data.servers || [];
}

export function useDevServersQuery() {
  return useQuery({
    queryKey: devServerKeys.list(),
    queryFn: fetchDevServers,
    staleTime: 3000,
    refetchInterval: (query) => {
      const servers = query.state.data;
      if (!servers?.length) return false;

      const hasRunning = servers.some((s) => s.status === "running");
      return hasRunning ? 5000 : 30000;
    },
  });
}

export function useStopDevServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (serverId: string) => {
      const res = await fetch(`/api/dev-servers/${serverId}/stop`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to stop dev server");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devServerKeys.list() });
    },
  });
}

export function useRestartDevServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (serverId: string) => {
      const res = await fetch(`/api/dev-servers/${serverId}/restart`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to restart dev server");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devServerKeys.list() });
    },
  });
}

export function useRemoveDevServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (serverId: string) => {
      const res = await fetch(`/api/dev-servers/${serverId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove dev server");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devServerKeys.list() });
    },
  });
}

interface CreateDevServerOptions {
  projectId: string;
  type: "node" | "docker";
  name: string;
  command: string;
  workingDirectory: string;
  ports?: number[];
}

export function useCreateDevServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts: CreateDevServerOptions) => {
      const res = await fetch("/api/dev-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) throw new Error("Failed to create dev server");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devServerKeys.list() });
    },
  });
}
