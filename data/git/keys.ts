export const gitKeys = {
  all: ["git"] as const,
  status: (workingDir: string) =>
    [...gitKeys.all, "status", workingDir] as const,
  multiStatus: (projectId: string, fallbackPath?: string) =>
    [...gitKeys.all, "multi-status", projectId, fallbackPath || ""] as const,
  pr: (workingDir: string) => [...gitKeys.all, "pr", workingDir] as const,
  history: (workingDir: string) =>
    [...gitKeys.all, "history", workingDir] as const,
  commitDetail: (workingDir: string, hash: string) =>
    [...gitKeys.all, "commit", workingDir, hash] as const,
  commitFileDiff: (workingDir: string, hash: string, file: string) =>
    [...gitKeys.all, "diff", workingDir, hash, file] as const,
};
