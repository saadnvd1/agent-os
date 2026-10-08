import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusMessageView, Delivery, Peer } from "@/lib/bus";
import { usePollWhenOffline } from "../push/connection";

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
    // Pushed when a message is written; polled only while the stream is down.
    refetchInterval: usePollWhenOffline(3000),
    enabled,
  });
}

export function useBusPeers(enabled = true) {
  return useQuery({
    queryKey: busKeys.peers(),
    queryFn: async () =>
      (await json<{ peers: Peer[] }>(await fetch("/api/bus/peers"))).peers,
    // Each peer's live status is read when asked, not pushed: looked at
    // every 30s (10s while the stream is down), and when sessions change.
    refetchInterval: usePollWhenOffline(10000) || 30000,
    enabled,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { to: string; body: string }) =>
      json<{ delivery: Delivery; note?: string }>(
        await fetch("/api/bus/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: null, ...input }),
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: busKeys.all }),
  });
}
