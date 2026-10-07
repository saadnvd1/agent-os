import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotifySettingsView, Outcome } from "@/lib/notify";

export const notifyKeys = { settings: ["notify", "settings"] as const };

async function call<T>(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

export function useNotifySettings(enabled = true) {
  return useQuery({
    queryKey: notifyKeys.settings,
    queryFn: async () =>
      (await call<{ settings: NotifySettingsView }>("/api/notify/settings"))
        .settings,
    enabled,
  });
}

export function useSaveTelegram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      telegramToken?: string | null;
      telegramChatId?: string | null;
    }) =>
      call<{ settings: NotifySettingsView }>(
        "/api/notify/settings",
        "PUT",
        input
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(notifyKeys.settings, data.settings),
  });
}

export function useTestNotify() {
  return useMutation({
    mutationFn: () => call<Outcome>("/api/notify/test", "POST", {}),
  });
}
