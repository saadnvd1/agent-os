import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwayView } from "@/lib/away/view";
import { post } from "../orchestrators";
import { usePollWhenOffline } from "../push/connection";

export const awayKeys = {
  all: ["away"] as const,
};

export function useAwayQuery() {
  return useQuery({
    queryKey: awayKeys.all,
    queryFn: async () => {
      const res = await fetch("/api/away");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return (await res.json()) as AwayView;
    },
    staleTime: 10_000,
    // Pushed when it changes (away_periods); a minute catches it running
    // out while the stream is down.
    refetchInterval: usePollWhenOffline(60_000),
  });
}

// expiresAt null: until he's back. `false` turns it off.
export function useSetAway() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: false | { expiresAt: Date | null }) =>
      post(
        "/api/away",
        on
          ? { on: true, expiresAt: on.expiresAt?.toISOString() ?? null }
          : { on: false }
      ) as Promise<AwayView>,
    onSuccess: (view) => queryClient.setQueryData(awayKeys.all, view),
    onSettled: () => queryClient.invalidateQueries({ queryKey: awayKeys.all }),
  });
}

export function useDismissAwayReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post("/api/away/seen", { id }),
    onMutate: () =>
      queryClient.setQueryData<AwayView>(awayKeys.all, (prev) =>
        prev ? { ...prev, report: null } : prev
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: awayKeys.all }),
  });
}

// The choices the toggle offers, as when each ends.
export const AWAY_DURATIONS = [
  { id: "1h", label: "For 1 hour" },
  { id: "4h", label: "For 4 hours" },
  { id: "morning", label: "Until morning" },
  { id: "back", label: "Until I'm back" },
] as const;

export type AwayDuration = (typeof AWAY_DURATIONS)[number]["id"];

// "Until morning" is 8 AM, local: today's if it's still before 5 AM,
// else tomorrow's.
export function awayEnds(d: AwayDuration, now = new Date()): Date | null {
  if (d === "1h") return new Date(now.getTime() + 60 * 60 * 1000);
  if (d === "4h") return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  if (d === "back") return null;
  const morning = new Date(now);
  morning.setHours(8, 0, 0, 0);
  if (now.getHours() >= 5) morning.setDate(morning.getDate() + 1);
  return morning;
}

// How recent a session's last real turn must be for Away mode to touch it.
export interface AwaySettings {
  windowMinutes: number;
}

const settingsKey = [...awayKeys.all, "settings"] as const;

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useAwaySettingsQuery() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async () => json<AwaySettings>(await fetch("/api/away/settings")),
    staleTime: 60_000,
  });
}

export function useUpdateAwaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AwaySettings) =>
      json<AwaySettings>(
        await fetch("/api/away/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
  });
}
