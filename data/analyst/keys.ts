export const analystKeys = {
  all: ["analyst"] as const,
  link: (id: string) => [...analystKeys.all, "link", id] as const,
  ofSession: (sessionId: string) =>
    [...analystKeys.all, "session", sessionId] as const,
};
