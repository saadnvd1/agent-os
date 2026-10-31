import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TipsView } from "@/lib/tips/schema";

export const tipsKeys = { all: ["tips"] as const };

// The browser's own date: the tip changes at the user's midnight.
const localDay = () => new Date().toLocaleDateString("sv");

async function send(init?: { body: object }): Promise<TipsView> {
  const res = await fetch(
    init ? "/api/tips" : `/api/tips?day=${localDay()}`,
    init && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(init.body),
    }
  ).catch(() => {
    throw new Error("Couldn't reach AgentOS. Try again.");
  });
  if (!res.ok) throw new Error(`Tips failed (${res.status})`);
  return res.json();
}

// The tips file only changes with an update; the day can change under an open tab.
export const useTips = () =>
  useQuery({
    queryKey: tipsKeys.all,
    queryFn: () => send(),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: true,
  });

function useTipsMutation<V>(body: (v: V) => object) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => send({ body: body(v) }),
    onSuccess: (view) => queryClient.setQueryData(tipsKeys.all, view),
  });
}

export const useMarkTipSeen = () =>
  useTipsMutation<string>((id) => ({
    action: "seen",
    ids: [id],
    day: localDay(),
  }));

export const useSetTipsOff = () =>
  useTipsMutation<boolean>((off) => ({ action: "off", off }));
