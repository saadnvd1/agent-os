import { useQuery } from "@tanstack/react-query";
import type {
  ContextItem,
  SearchResponse,
} from "@/lib/search/conversations/types";
import { searchKeys } from "./keys";

export type {
  ContextItem,
  ConversationGroup,
  ConversationHit,
  SearchResponse,
  SnippetSegment,
} from "@/lib/search/conversations/types";

export const MIN_QUERY = 2;

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/**
 * What was said in chats, grouped by conversation. A request for words the
 * reader has since typed past is cancelled; the last results stay up until
 * the new ones arrive.
 */
export function useConversationSearch(
  q: string,
  workspace: string,
  { limit = 30, enabled = true }: { limit?: number; enabled?: boolean } = {}
) {
  const text = q.trim();
  return useQuery({
    queryKey: searchKeys.conversations(text, workspace, limit),
    queryFn: ({ signal }) =>
      fetch(
        `/api/search/conversations?${new URLSearchParams({ q: text, workspace, limit: String(limit) })}`,
        { signal }
      ).then((r) => json<SearchResponse>(r)),
    enabled: enabled && text.length >= MIN_QUERY,
    placeholderData: (previous) => previous,
    staleTime: 5_000,
  });
}

/** A hit and the messages around it, for the preview. */
export function useMessageContext(
  sessionId: string | undefined,
  itemId: string | undefined
) {
  return useQuery({
    queryKey: searchKeys.context(sessionId ?? "", itemId ?? ""),
    queryFn: ({ signal }) =>
      fetch(
        `/api/search/conversations/context?${new URLSearchParams({ session: sessionId!, item: itemId! })}`,
        { signal }
      )
        .then((r) => json<{ items: ContextItem[] }>(r))
        .then((d) => d.items),
    enabled: !!sessionId && !!itemId,
    staleTime: 60_000,
  });
}
