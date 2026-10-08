import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Host } from "@/lib/db";
import type { DiscoveredSession } from "@/lib/hosts/discover";
import { hostKeys } from "./keys";
import { usePollWhenOffline } from "../push/connection";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useHostsQuery() {
  return useQuery({
    queryKey: hostKeys.list(),
    queryFn: async () =>
      (await json<{ hosts: Host[] }>(await fetch("/api/hosts"))).hosts,
    staleTime: 60000,
  });
}

export function useHostNames(): Record<string, string> {
  const { data: hosts = [] } = useHostsQuery();
  return Object.fromEntries(hosts.map((h) => [h.id, h.name]));
}

export function useDiscoveredTmuxQuery() {
  return useQuery({
    queryKey: hostKeys.discovered(),
    queryFn: async () =>
      json<{
        sessions: DiscoveredSession[];
        hostErrors: Record<string, string>;
      }>(await fetch("/api/tmux/discover")),
    // Pushed when the set of sessions found changes ("discovered").
    refetchInterval: usePollWhenOffline(5000),
  });
}

export function useCreateHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; sshTarget: string }) =>
      json<{ host: Host }>(
        await fetch("/api/hosts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hostKeys.all }),
  });
}

export function useDeleteHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      json(await fetch(`/api/hosts/${id}`, { method: "DELETE" })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hostKeys.all }),
  });
}

export interface HostTestResult {
  ok: boolean;
  hostname?: string;
  tmux?: string;
  error?: string;
}

export function useTestHost() {
  return useMutation({
    mutationFn: async (id: string) =>
      json<HostTestResult>(
        await fetch(`/api/hosts/${id}/test`, { method: "POST" })
      ),
  });
}

export function useLinkHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      json<{ url: string }>(
        await fetch(`/api/hosts/${id}/link`, { method: "POST" })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hostKeys.all }),
  });
}

/** Machines whose own AgentOS this one is paired with: tasks can run there. */
export function useLinkedHosts(): Host[] {
  const { data: hosts = [] } = useHostsQuery();
  return hosts.filter((h) => h.id !== "local" && Boolean(h.linked));
}
