import { useState, useCallback, useEffect } from "react";
import type { DevServer } from "@/lib/db";

interface CreateDevServerOptions {
  projectId: string;
  type: "node" | "docker";
  name: string;
  command: string;
  workingDirectory: string;
  ports?: number[];
}

interface UseDevServersManagerReturn {
  devServers: DevServer[];
  startDevServerProjectId: string | null;
  setStartDevServerProjectId: (id: string | null) => void;
  fetchDevServers: () => Promise<void>;
  startDevServer: (projectId: string) => void;
  stopDevServer: (serverId: string) => Promise<void>;
  restartDevServer: (serverId: string) => Promise<void>;
  removeDevServer: (serverId: string) => Promise<void>;
  createDevServer: (opts: CreateDevServerOptions) => Promise<void>;
}

export function useDevServersManager(): UseDevServersManagerReturn {
  const [devServers, setDevServers] = useState<DevServer[]>([]);
  const [startDevServerProjectId, setStartDevServerProjectId] = useState<string | null>(null);

  const fetchDevServers = useCallback(async () => {
    try {
      const res = await fetch("/api/dev-servers");
      const data = await res.json();
      setDevServers(data.servers || []);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (error instanceof TypeError && error.message === "Failed to fetch") return;
      console.error("Failed to fetch dev servers:", error);
    }
  }, []);

  // Poll for dev servers every 5 seconds
  useEffect(() => {
    fetchDevServers();
    const interval = setInterval(fetchDevServers, 5000);
    return () => clearInterval(interval);
  }, [fetchDevServers]);

  const startDevServer = useCallback((projectId: string) => {
    setStartDevServerProjectId(projectId);
  }, []);

  const stopDevServer = useCallback(async (serverId: string) => {
    await fetch(`/api/dev-servers/${serverId}/stop`, { method: "POST" });
    await fetchDevServers();
  }, [fetchDevServers]);

  const restartDevServer = useCallback(async (serverId: string) => {
    await fetch(`/api/dev-servers/${serverId}/restart`, { method: "POST" });
    await fetchDevServers();
  }, [fetchDevServers]);

  const removeDevServer = useCallback(async (serverId: string) => {
    await fetch(`/api/dev-servers/${serverId}`, { method: "DELETE" });
    await fetchDevServers();
  }, [fetchDevServers]);

  const createDevServer = useCallback(async (opts: CreateDevServerOptions) => {
    await fetch("/api/dev-servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    await fetchDevServers();
    setStartDevServerProjectId(null);
  }, [fetchDevServers]);

  return {
    devServers,
    startDevServerProjectId,
    setStartDevServerProjectId,
    fetchDevServers,
    startDevServer,
    stopDevServer,
    restartDevServer,
    removeDevServer,
    createDevServer,
  };
}
