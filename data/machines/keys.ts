export const machineKeys = {
  all: ["machines"] as const,
  agents: (hostId: string, projectId: string | null = null) =>
    [...machineKeys.all, "agents", hostId, projectId] as const,
  browser: () => [...machineKeys.all, "browser"] as const,
};
