export const searchKeys = {
  all: ["search"] as const,
  conversations: (q: string, workspace: string, limit: number) =>
    [...searchKeys.all, "conversations", q, workspace, limit] as const,
  context: (sessionId: string, itemId: string) =>
    [...searchKeys.all, "context", sessionId, itemId] as const,
};
