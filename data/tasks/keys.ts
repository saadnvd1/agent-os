export const taskKeys = {
  all: ["tasks"] as const,
  list: () => [...taskKeys.all, "list"] as const,
  queue: () => [...taskKeys.all, "queue"] as const,
  move: (id: string) => [...taskKeys.all, "move", id] as const,
};
