export const sessionArtifactKeys = {
  all: ["session-artifacts"] as const,
  session: (sessionId: string) =>
    [...sessionArtifactKeys.all, sessionId] as const,
  content: (url: string) =>
    [...sessionArtifactKeys.all, "content", url] as const,
};
