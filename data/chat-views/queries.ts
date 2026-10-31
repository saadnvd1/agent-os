import { useQuery } from "@tanstack/react-query";
import type { ChatView, ChatViewInput } from "@/lib/chat-views/types";
import { chatViewKeys } from "./keys";

export type { ChatView } from "@/lib/chat-views/types";

/** Where each chat was last read and when, newest first. Another device's
 * reading shows up when this tab is focused again. */
export function useChatViews() {
  return useQuery({
    queryKey: chatViewKeys.all,
    queryFn: async (): Promise<ChatView[]> => {
      const res = await fetch("/api/chat-views");
      if (!res.ok) throw new Error("Failed to fetch chat views");
      return (await res.json()).views;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Saves where the reader is, or (null) that they just opened the chat.
 * keepalive lets it finish while the page unloads. */
export function saveChatView(
  sessionId: string,
  input: (Omit<ChatViewInput, "advance"> & { advance?: boolean }) | null
): void {
  void fetch(`/api/chat-views/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? { viewed: true }),
    keepalive: true,
  }).catch(() => {});
}
