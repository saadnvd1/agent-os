export const liveKeys = {
  all: ["live-shares"] as const,
  session: (sessionId: string) => [...liveKeys.all, sessionId] as const,
};
