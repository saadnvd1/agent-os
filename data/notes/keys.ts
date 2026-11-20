export const noteKeys = {
  all: ["session-notes"] as const,
  session: (sessionId: string) => [...noteKeys.all, sessionId] as const,
};
