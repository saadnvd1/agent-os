import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatedShare,
  PreviewRequest,
  SharePreview,
  SharesResponse,
  ShareExpiry,
} from "@/lib/share/view";
import { shareKeys } from "./keys";

export type {
  CreatedShare,
  PreviewItem,
  PreviewRequest,
  SharedLinkRow,
  SharePreview,
  SharesResponse,
  ShareExpiry,
  ShareTarget,
} from "@/lib/share/view";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** What would be uploaded, redacted. Local only. */
export function useSharePreview() {
  return useMutation({
    mutationFn: async (req: PreviewRequest) =>
      json<SharePreview>(await post("/api/shares/preview", req)),
  });
}

/** The share as a PDF, printed by the server. */
export function useSharePdf() {
  return useMutation({
    mutationFn: async (req: PreviewRequest): Promise<Blob> => {
      const res = await post("/api/shares/pdf", req);
      if (!res.ok) return json<Blob>(res);
      return res.blob();
    },
  });
}

export function useCreateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      req: PreviewRequest & {
        sharedAt: string;
        hash: string;
        expiresIn: ShareExpiry;
      }
    ) => json<CreatedShare>(await post("/api/shares", req)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shareKeys.all }),
  });
}

export function useSharesQuery(enabled = true) {
  return useQuery({
    queryKey: shareKeys.list(),
    queryFn: async () => json<SharesResponse>(await fetch("/api/shares")),
    enabled,
  });
}

export function useRevokeShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      json<{ ok: true }>(
        await fetch(`/api/shares/${id}`, { method: "DELETE" })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shareKeys.all }),
  });
}
