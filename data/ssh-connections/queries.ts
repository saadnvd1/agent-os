import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SSHConnection } from "@/lib/db/types";
import { sshConnectionKeys } from "./keys";
import { projectKeys } from "../projects/keys";

async function fetchSSHConnections(): Promise<SSHConnection[]> {
  const res = await fetch("/api/ssh-connections");
  if (!res.ok) throw new Error("Failed to fetch SSH connections");
  const data = await res.json();
  return data.connections || [];
}

export function useSSHConnectionsQuery() {
  return useQuery({
    queryKey: sshConnectionKeys.list(),
    queryFn: fetchSSHConnections,
    staleTime: 60000, // 1 minute - SSH connections don't change often
  });
}

export function useCreateSSHConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      host: string;
      port: number;
      user: string;
      key_path: string | null;
    }) => {
      const res = await fetch("/api/ssh-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create SSH connection");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sshConnectionKeys.list() });
    },
  });
}

export function useUpdateSSHConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      host?: string;
      port?: number;
      user?: string;
      key_path?: string | null;
    }) => {
      const res = await fetch(`/api/ssh-connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update SSH connection");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sshConnectionKeys.list() });
      queryClient.invalidateQueries({
        queryKey: sshConnectionKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteSSHConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ssh-connections/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete SSH connection");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sshConnectionKeys.list() });
      // Also invalidate projects since they reference SSH connections
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useTestSSHConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ssh-connections/${id}/test`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Connection test failed");
      }
      return res.json() as Promise<{ success: boolean; error?: string }>;
    },
  });
}
