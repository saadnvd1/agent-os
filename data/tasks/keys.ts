export const taskKeys = {
  all: ["tasks"] as const,
  list: () => [...taskKeys.all, "list"] as const,
  move: (id: string) => [...taskKeys.all, "move", id] as const,
};
