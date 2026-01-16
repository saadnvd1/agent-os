export const codeSearchKeys = {
  all: ["code-search"] as const,
  available: () => [...codeSearchKeys.all, "available"] as const,
  searches: () => [...codeSearchKeys.all, "searches"] as const,
  search: (path: string, query: string) =>
    [...codeSearchKeys.searches(), path, query] as const,
};
