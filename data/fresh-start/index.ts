import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RefreshSettings } from "@/lib/chat/refresh";

// When chats start a fresh conversation (lib/chat/refresh).
export const freshStartKeys = { all: ["fresh-start"] as const };

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useFreshStartQuery() {
  return useQuery({
    queryKey: freshStartKeys.all,
    queryFn: async () => json<RefreshSettings>(await fetch("/api/fresh-start")),
    staleTime: 60000,
  });
}

export function useUpdateFreshStart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<RefreshSettings>) =>
      json<RefreshSettings>(
        await fetch("/api/fresh-start", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(freshStartKeys.all, data),
  });
}
