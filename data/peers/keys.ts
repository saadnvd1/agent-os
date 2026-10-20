export const peerKeys = {
  all: ["peers"] as const,
  account: () => [...peerKeys.all, "account"] as const,
  pending: () => [...peerKeys.all, "pending"] as const,
  link: (id: string) => [...peerKeys.all, "link", id] as const,
};
