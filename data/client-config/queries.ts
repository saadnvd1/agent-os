import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ClientConfig } from "@/lib/config/client-config-types";

export const clientConfigKeys = { all: ["client-config"] as const };

// What the server says clients render with and are limited by; it only
// changes with a server release, so one read per page load.
export const clientConfigQuery = queryOptions({
  queryKey: clientConfigKeys.all,
  queryFn: async (): Promise<ClientConfig> => {
    const res = await fetch("/api/client-config");
    if (!res.ok) throw new Error("Couldn't read the server's limits");
    return res.json();
  },
  staleTime: Infinity,
});

export const useClientConfig = () => useQuery(clientConfigQuery);

/** The owner's own name, or null until they set one (see lib/owner-label). */
export const useOwnerName = () => useClientConfig().data?.ownerName ?? null;
