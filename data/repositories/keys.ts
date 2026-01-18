export const repositoryKeys = {
  all: ["repositories"] as const,
  list: (projectId: string) =>
    [...repositoryKeys.all, "list", projectId] as const,
};
