import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditRow } from "@/lib/peer/audit";
import type { AccountMachines } from "@/lib/peer/machines";
import type { PendingView } from "@/lib/peer/pairing";
import type { Outgoing } from "@/lib/peer/pairing-out";
import { hostKeys } from "../hosts/keys";
import { peerKeys } from "./keys";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      attemptsLeft: data.attemptsLeft as number | undefined,
    });
  return data;
}

const post = (url: string, body?: object) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

/** The other machines on this Connect account, and the plan. */
export function useAccountMachines(enabled: boolean) {
  return useQuery({
    queryKey: peerKeys.account(),
    queryFn: async () =>
      json<AccountMachines>(await fetch("/api/peers/account")),
    enabled,
    staleTime: 30_000,
  });
}

export function useRefreshAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      json<AccountMachines>(await fetch("/api/peers/account?refresh=1")),
    onSuccess: (data) => queryClient.setQueryData(peerKeys.account(), data),
  });
}

/** Machines asking to link here: shown on every page until answered. */
export function usePendingLinks() {
  return useQuery({
    queryKey: peerKeys.pending(),
    queryFn: async () =>
      (
        await json<{ requests: PendingView[] }>(
          await fetch("/api/peers/pending")
        )
      ).requests,
    refetchInterval: 10_000,
  });
}

export function useStartLink() {
  return useMutation({
    mutationFn: async (machineId: string) =>
      (
        await json<{ link: Outgoing }>(
          await post("/api/peers/link", { machineId })
        )
      ).link,
  });
}

/** A link this machine started, followed until it ends. */
export function useOutgoingLink(id: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: peerKeys.link(id ?? ""),
    queryFn: async () => {
      const { link } = await json<{ link: Outgoing }>(
        await fetch(`/api/peers/link/${id}`)
      );
      if (link.state === "accepted") {
        void queryClient.invalidateQueries({ queryKey: hostKeys.all });
        void queryClient.invalidateQueries({ queryKey: peerKeys.account() });
      }
      return link;
    },
    enabled: !!id,
    refetchInterval: (q) =>
      !q.state.data || q.state.data.state === "pending" ? 1500 : false,
  });
}

/** The code the other machine shows once it took ours: only it pins it. */
export function useConfirmLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (o: { id: string; code: string }) =>
      (
        await json<{ link: Outgoing }>(
          await post(`/api/peers/link/${o.id}/confirm`, { code: o.code })
        )
      ).link,
    onSuccess: (link) => {
      queryClient.setQueryData(peerKeys.link(link.id), link);
      void queryClient.invalidateQueries({ queryKey: hostKeys.all });
      void queryClient.invalidateQueries({ queryKey: peerKeys.account() });
    },
    // Three wrong codes end it: show that.
    onError: (_e, o) =>
      void queryClient.invalidateQueries({ queryKey: peerKeys.link(o.id) }),
  });
}

export function useCancelLink() {
  return useMutation({
    mutationFn: async (id: string) =>
      json(await fetch(`/api/peers/link/${id}`, { method: "DELETE" })),
  });
}

export function useAnswerLink() {
  const queryClient = useQueryClient();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: peerKeys.all });
    void queryClient.invalidateQueries({ queryKey: hostKeys.all });
  };
  return {
    accept: useMutation({
      mutationFn: async (o: { id: string; code: string }) =>
        json<{ hostId: string; name: string; confirmCode: string }>(
          await post(`/api/peers/pending/${o.id}/accept`, { code: o.code })
        ),
      onSuccess: done,
      // A wrong code changes how many tries are left.
      onError: () =>
        void queryClient.invalidateQueries({ queryKey: peerKeys.pending() }),
    }),
    decline: useMutation({
      mutationFn: async (id: string) =>
        json(await post(`/api/peers/pending/${id}/decline`)),
      onSuccess: done,
    }),
  };
}

/** Unlinks a machine linked through Connect, here and (if it answers) there. */
export function useUnlinkPeer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (hostId: string) =>
      json<{ name: string; told: boolean; removed: boolean }>(
        await fetch(`/api/peers/${hostId}`, { method: "DELETE" })
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hostKeys.all });
      void queryClient.invalidateQueries({ queryKey: peerKeys.account() });
    },
  });
}

/** Every call to and from a linked machine, newest first. */
export function usePeerAudit(hostId: string | null) {
  return useQuery({
    queryKey: peerKeys.audit(hostId ?? ""),
    queryFn: async () =>
      (
        await json<{ rows: AuditRow[] }>(
          await fetch(`/api/peers/${hostId}/audit`)
        )
      ).rows,
    enabled: !!hostId,
    refetchInterval: 15_000,
  });
}
