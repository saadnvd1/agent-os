export const shareKeys = {
  all: ["shares"] as const,
  list: () => [...shareKeys.all, "list"] as const,
};
