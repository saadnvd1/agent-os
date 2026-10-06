import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Device } from "@/lib/security/devices";
import type { NetworkState } from "@/lib/security/network-state";
import type { PairingOffer } from "@/lib/security/pair-qr";
import { deviceKeys } from "./keys";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export interface DevicesResponse {
  devices: Device[];
  current: { deviceId: string | null; via: string | null };
}

export function useDevicesQuery(enabled = true) {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: async () => json<DevicesResponse>(await fetch("/api/devices")),
    enabled,
  });
}

export function useNetworkQuery(enabled = true) {
  return useQuery({
    queryKey: deviceKeys.network(),
    queryFn: async () =>
      json<NetworkState>(await fetch("/api/devices/network")),
    enabled,
  });
}

export function useUpdateNetwork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      lan?: boolean;
      requirePairingOnTailnet?: boolean;
    }) =>
      json<NetworkState>(
        await fetch("/api/devices/network", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(deviceKeys.network(), data),
  });
}

export function useStartPairing() {
  return useMutation({
    mutationFn: async () =>
      json<PairingOffer>(await fetch("/api/pair/start", { method: "POST" })),
  });
}

export function usePairingStatus(code: string | null) {
  return useQuery({
    queryKey: deviceKeys.pairing(code ?? ""),
    queryFn: async () =>
      json<{
        state: "waiting" | "claimed" | "expired" | "unknown";
        name?: string;
      }>(await fetch(`/api/pair/status?code=${encodeURIComponent(code!)}`)),
    enabled: !!code,
    refetchInterval: (q) => (q.state.data?.state === "waiting" ? 1500 : false),
  });
}

export function useRevokeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      json<{ ok: true }>(
        await fetch(`/api/devices/${id}`, { method: "DELETE" })
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() }),
  });
}

export function useRenameDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      json<{ ok: true }>(
        await fetch(`/api/devices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        })
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() }),
  });
}
