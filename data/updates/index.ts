import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isActivePhase, type UpdateView } from "@/lib/updates/banner";

export const updateKeys = { all: ["updates"] as const };

async function send(
  method: string,
  url: string,
  body?: object
): Promise<UpdateView> {
  const res = await fetch(url, {
    method,
    ...(body && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  }).catch(() => {
    throw new Error("Couldn't reach AgentOS. Try again.");
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(
      new Error(data.error || `Request failed (${res.status})`),
      { status: res.status }
    );
  return data;
}

// Polled quickly only while an update runs; the server looks for new
// versions itself, so a half hour is plenty for the rest.
export function useUpdates() {
  return useQuery({
    queryKey: updateKeys.all,
    queryFn: () => send("GET", "/api/updates"),
    staleTime: 5 * 60_000,
    refetchInterval: (query) =>
      isActivePhase(query.state.data?.run?.phase) ? 2000 : 30 * 60_000,
  });
}

function useUpdateMutation<V>(fn: (v: V) => Promise<UpdateView>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => queryClient.setQueryData(updateKeys.all, view),
  });
}

export const useCheckForUpdates = () =>
  useUpdateMutation<void>(() => send("POST", "/api/updates/check"));

export const useRunUpdate = () =>
  useUpdateMutation<"now" | "idle">((when) =>
    send("POST", "/api/updates/run", { when })
  );

export const useCancelUpdate = () =>
  useUpdateMutation<void>(() => send("DELETE", "/api/updates/run"));

export const useUpdateBannerSetting = () =>
  useUpdateMutation<boolean>((banner) =>
    send("PUT", "/api/updates/settings", { banner })
  );
