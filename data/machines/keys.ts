export const machineKeys = {
  all: ["machines"] as const,
  agents: (hostId: string) => [...machineKeys.all, "agents", hostId] as const,
  browser: () => [...machineKeys.all, "browser"] as const,
};
