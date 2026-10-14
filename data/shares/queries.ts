import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shareKeys } from "./keys";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export type ShareExpiry = "1d" | "7d" | "30d" | "never";

export interface ShareTarget {
  kind: "chat" | "artifact";
  sessionId?: string;
  artifactId?: string;
}

export interface PreviewRequest extends ShareTarget {
  includeTools: boolean;
  /** Messages left out of the share. */
  dropIds?: string[];
}

export interface PreviewItem {
  id: string;
  type: string;
  tools: boolean;
  excerpt: string;
}

export interface SharePreview {
  html: string;
  title: string;
  bytes: number;
  hash: string;
  sharedAt: string;
  items: PreviewItem[];
  hits: Record<"secret" | "path" | "ip" | "host" | "email", number>;
  tooBig: boolean;
  connectLinked: boolean;
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

export function useCreateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      req: PreviewRequest & {
        sharedAt: string;
        hash: string;
        expiresIn: ShareExpiry;
      }
    ) =>
      json<{ id: string; url: string; expiresAt: string | null }>(
        await post("/api/shares", req)
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shareKeys.all }),
  });
}

export interface SharedLinkRow {
  id: string;
  url: string;
  kind: "chat" | "artifact";
  title: string;
  sessionId: string | null;
  artifactId: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "revoked";
  views: number | null;
  lastViewedAt: string | null;
}

export interface SharesResponse {
  connect: "ok" | "unavailable" | "unlinked";
  shares: SharedLinkRow[];
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
