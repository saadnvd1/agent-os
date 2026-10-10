export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
  machines: (id: string) => [...projectKeys.all, "machines", id] as const,
};
