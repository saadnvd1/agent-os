import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ListedDevice } from "@/lib/security/devices";
import type { NetworkState } from "@/lib/security/network-state";
import type { PairingOffer } from "@/lib/security/pair-qr";
import { deviceKeys } from "./keys";
import { provePresence } from "../presence";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export interface DevicesResponse {
  devices: ListedDevice[];
  // Whether this machine can reach the push relay at all.
  push: { linked: boolean; unavailable: string | null };
  current: { deviceId: string | null; via: string | null };
}

export function useDevicesQuery(enabled = true) {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: async () => json<DevicesResponse>(await fetch("/api/devices")),
    enabled,
  });
}

export function useNetworkQuery(
  enabled = true,
  refetchMs: number | false = false
) {
  return useQuery({
    queryKey: deviceKeys.network(),
    queryFn: async () =>
      json<NetworkState>(await fetch("/api/devices/network")),
    enabled,
    refetchInterval: refetchMs,
  });
}

/** Links this machine to Connect with a code from runagentos.com. */
export function useLinkConnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      json<NetworkState>(
        await fetch("/api/devices/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(deviceKeys.network(), data),
  });
}

export function useUpdateNetwork() {
  const queryClient = useQueryClient();
  return useMutation({
    // Switching merge approvals off needs a passkey.
    mutationFn: async (body: {
      lan?: boolean;
      requirePairingOnTailnet?: boolean;
      connect?: boolean;
      mergeApprovals?: boolean;
    }) =>
      json<NetworkState>(
        await fetch("/api/devices/network", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            ...(body.mergeApprovals === false
              ? { assertion: await provePresence({ purpose: "approvals-off" }) }
              : {}),
          }),
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

export function useSetCanApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      canApprove,
    }: {
      id: string;
      canApprove: boolean;
    }) =>
      json(
        await fetch(`/api/devices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canApprove }),
        })
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() }),
  });
}

export interface PushTestResponse {
  results: {
    deviceId: string;
    status: "sent" | "gone" | "failed";
    error: string | null;
  }[];
  unavailable: string | null;
}

export function useSendTestPush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: string) =>
      json<PushTestResponse>(
        await fetch("/api/push/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId }),
        })
      ),
    // A dead token is forgotten, and the last error changes.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() }),
  });
}
