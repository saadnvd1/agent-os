export const sessionArtifactKeys = {
  all: ["session-artifacts"] as const,
  session: (sessionId: string) =>
    [...sessionArtifactKeys.all, sessionId] as const,
  content: (url: string) =>
    [...sessionArtifactKeys.all, "content", url] as const,
  // A page's versions, by any version's id; pageId keys the invalidation.
  versions: (pageId: string) =>
    [...sessionArtifactKeys.all, "versions", pageId] as const,
  compare: (sessionId: string, from: string, to: string, mode: string) =>
    [...sessionArtifactKeys.all, "compare", sessionId, from, to, mode] as const,
};
