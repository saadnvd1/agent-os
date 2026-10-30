import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LiveExpiry,
  LiveInvite,
  LiveLevel,
  LiveResponse,
  LiveView,
} from "@/lib/live/types";
import { liveKeys } from "./keys";

export type {
  LiveExpiry,
  LiveInvite,
  LiveLevel,
  LiveResponse,
  LiveView,
} from "@/lib/live/types";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/**
 * The session's live link, who is waiting and who is watching. Asked every
 * couple of seconds while a link is live, and once a minute when not, so a
 * request or a suggestion shows up on the host's screen quickly.
 */
export function useLiveShare(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: liveKeys.session(sessionId ?? ""),
    enabled: enabled && !!sessionId,
    queryFn: async (): Promise<LiveResponse> =>
      json(await fetch(`/api/live-shares?sessionId=${sessionId}`)),
    select: (r) => ({
      linked: r.linked,
      share: r.shares[0] as LiveView | undefined,
      invite: r.invite as LiveInvite | undefined,
    }),
    refetchInterval: (q) => (q.state.data?.shares.length ? 2000 : 60_000),
  });
}

export function useCreateLive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: {
      sessionId: string;
      expiresIn: LiveExpiry;
      level: LiveLevel;
      history: boolean;
    }) => json<LiveView>(await send("/api/live-shares", "POST", req)),
    onSuccess: () => qc.invalidateQueries({ queryKey: liveKeys.all }),
  });
}

export type LiveAction =
  | { action: "admit"; guestId: string; drive?: boolean }
  | { action: "deny" | "kick"; guestId: string }
  | { action: "wheel"; guestId: string | null }
  | { action: "level"; level: LiveLevel }
  | { action: "send"; suggestionId: string; text?: string }
  | { action: "dismiss"; suggestionId: string };

export function useLiveAction(shareId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: LiveAction) =>
      json<{ ok: true }>(
        await send(`/api/live-shares/${shareId}`, "POST", req)
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: liveKeys.all }),
  });
}

export function useEndLive(shareId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      json<{ ok: true }>(await send(`/api/live-shares/${shareId}`, "DELETE")),
    onSettled: () => qc.invalidateQueries({ queryKey: liveKeys.all }),
  });
}

/** Every live link this machine holds, for the Shared links page. */
export function useAllLiveShares() {
  return useQuery({
    queryKey: [...liveKeys.all, "all"] as const,
    queryFn: async (): Promise<LiveResponse> =>
      json(await fetch("/api/live-shares")),
    refetchInterval: 5000,
  });
}
