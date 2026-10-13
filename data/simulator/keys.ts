export const simulatorKeys = {
  all: ["simulator"] as const,
  status: (sessionId: string) =>
    [...simulatorKeys.all, "status", sessionId] as const,
};
