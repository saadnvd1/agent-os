import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusMessageView, Peer } from "@/lib/bus";

export const busKeys = {
  all: ["bus"] as const,
  messages: () => [...busKeys.all, "messages"] as const,
  peers: () => [...busKeys.all, "peers"] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useBusMessages(enabled = true) {
  return useQuery({
    queryKey: busKeys.messages(),
    queryFn: async () =>
      (
        await json<{ messages: BusMessageView[] }>(
          await fetch("/api/bus/messages")
        )
      ).messages,
    refetchInterval: 3000,
    enabled,
  });
}

export function useBusPeers(enabled = true) {
  return useQuery({
    queryKey: busKeys.peers(),
    queryFn: async () =>
      (await json<{ peers: Peer[] }>(await fetch("/api/bus/peers"))).peers,
    refetchInterval: 10000,
    enabled,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { to: string; body: string }) =>
      json(
        await fetch("/api/bus/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: null, ...input }),
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: busKeys.all }),
  });
}
