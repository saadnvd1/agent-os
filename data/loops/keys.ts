export const loopKeys = {
  all: ["loop"] as const,
  ofTask: (taskId: string) => [...loopKeys.all, "task", taskId] as const,
};
