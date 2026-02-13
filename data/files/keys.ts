export const fileKeys = {
  all: ["files"] as const,
  list: (path: string) => [...fileKeys.all, "list", path] as const,
};
