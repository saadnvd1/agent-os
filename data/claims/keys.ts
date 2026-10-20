export const claimKeys = {
  all: ["claims"] as const,
  list: (project?: string) =>
    [...claimKeys.all, "list", project ?? ""] as const,
};
