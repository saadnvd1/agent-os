import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// How long a turn may be silent before it's stalled (lib/chat/stall).
export const stallKeys = { all: ["stall"] as const };

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useStallQuery() {
  return useQuery({
    queryKey: stallKeys.all,
    queryFn: async () => json<{ minutes: number }>(await fetch("/api/stall")),
    staleTime: 60000,
  });
}

export function useUpdateStall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (minutes: number) =>
      json<{ minutes: number }>(
        await fetch("/api/stall", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes }),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(stallKeys.all, data),
  });
}
