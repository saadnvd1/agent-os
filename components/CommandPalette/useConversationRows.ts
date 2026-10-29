"use client";

import { useMemo } from "react";
import { MessagesSquare, Search } from "lucide-react";
import type { PaletteCommand } from "@/lib/palette/registry";
import { MIN_QUERY, useConversationSearch } from "@/data/search";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import { paletteActions } from "@/stores/palette";
import { plain } from "./conversations/format";
import { useOpenHit } from "./conversations/useOpenHit";

// Conversation matches offered last in All.
const CONVERSATIONS = 3;

// The few conversations a query finds, then a way into the full search.
export function useConversationRows(
  query: string,
  enabled: boolean
): PaletteCommand[] {
  const { workspace } = useSelectedWorkspace();
  const debounced = useDebouncedValue(query.trim(), 150);
  const openHit = useOpenHit();
  const { data: found } = useConversationSearch(
    debounced,
    workspace?.id ?? "all",
    { limit: CONVERSATIONS, enabled }
  );
  return useMemo(() => {
    const q = query.trim();
    if (!enabled || q.length < MIN_QUERY || q !== debounced) return [];
    const hits = (found?.groups ?? []).flatMap((group) =>
      group.hits.slice(0, 1).map((hit) => ({
        id: `conversation:${group.sessionId}:${hit.itemId}`,
        title: group.name,
        detail: plain(hit.snippet),
        group: "Conversations",
        icon: MessagesSquare,
        run: () => openHit(group, hit),
        keepOpen: true,
      }))
    );
    return [
      ...hits,
      {
        id: "conversation:all",
        title: `Search all conversations for “${q}”`,
        group: "Conversations",
        icon: Search,
        keepOpen: true,
        run: () => paletteActions.setTab("conversations", q),
      },
    ];
  }, [found, query, debounced, enabled, openHit]);
}
