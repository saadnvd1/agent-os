export const systemKeys = {
  all: ["system"] as const,
  version: () => [...systemKeys.all, "version"] as const,
};
