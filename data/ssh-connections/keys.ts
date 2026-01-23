export const sshConnectionKeys = {
  all: ["ssh-connections"] as const,
  list: () => [...sshConnectionKeys.all, "list"] as const,
  detail: (id: string) => [...sshConnectionKeys.all, id] as const,
};
