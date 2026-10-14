export const bookmarkKeys = {
  all: ["bookmarks"] as const,
  session: (sessionId: string) =>
    [...bookmarkKeys.all, "session", sessionId] as const,
  list: (workspace: string, q: string) =>
    [...bookmarkKeys.all, "list", workspace, q] as const,
};
