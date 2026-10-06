export const hostKeys = {
  all: ["hosts"] as const,
  list: () => [...hostKeys.all, "list"] as const,
  discovered: () => [...hostKeys.all, "discovered"] as const,
};
