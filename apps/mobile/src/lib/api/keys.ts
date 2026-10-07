export const keys = {
  sessions: (m: string) => ["sessions", m] as const,
  projects: (m: string) => ["projects", m] as const,
  workspaces: (m: string) => ["workspaces", m] as const,
  tasks: (m: string) => ["tasks", m] as const,
  statuses: (m: string) => ["statuses", m] as const,
  asks: (m: string) => ["asks", m] as const,
  preview: (m: string, id: string) => ["preview", m, id] as const,
};
