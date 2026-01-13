export const devServerKeys = {
  all: ["dev-servers"] as const,
  list: () => [...devServerKeys.all, "list"] as const,
};
