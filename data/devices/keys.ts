export const deviceKeys = {
  all: ["devices"] as const,
  list: () => [...deviceKeys.all, "list"] as const,
  network: () => [...deviceKeys.all, "network"] as const,
  pairing: (code: string) => [...deviceKeys.all, "pairing", code] as const,
};
