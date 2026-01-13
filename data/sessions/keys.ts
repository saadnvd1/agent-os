export const sessionKeys = {
  all: ["sessions"] as const,
  list: () => [...sessionKeys.all, "list"] as const,
};

export const statusKeys = {
  all: ["session-statuses"] as const,
};
