import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  bookmarkKey,
  type Bookmark,
  type BookmarkScope,
  type BookmarksPage,
} from "@/lib/bookmarks/types";
import { bookmarkKeys } from "./keys";

export type {
  Bookmark,
  BookmarkScope,
  BookmarkState,
  BookmarksPage,
} from "@/lib/bookmarks/types";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** One chat's bookmarks, in chat order: what its stars and list read. */
export function useSessionBookmarks(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: bookmarkKeys.session(sessionId ?? ""),
    queryFn: async () =>
      (
        await json<{ bookmarks: Bookmark[] }>(
          await fetch(`/api/sessions/${sessionId}/bookmarks`)
        )
      ).bookmarks,
    enabled: !!sessionId,
    staleTime: 30_000,
  });
}

/** Bookmarks across chats, a page at a time. `workspace`: an id or "all". */
export function useBookmarks(workspace: string, q: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: bookmarkKeys.list(workspace, q),
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ workspace, q });
      if (pageParam) p.set("before", pageParam);
      return json<BookmarksPage>(await fetch(`/api/bookmarks?${p}`));
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled,
  });
}

/**
 * Stars or unstars an item. The star flips at once; the server's answer
 * (or the change topic) settles it.
 */
export function useToggleBookmark(sessionId: string) {
  const qc = useQueryClient();
  const key = bookmarkKeys.session(sessionId);
  return useMutation({
    mutationFn: async (v: {
      itemId: string;
      scope: BookmarkScope;
      existing: Bookmark | null;
    }) => {
      if (v.existing) {
        await json(await send(`/api/bookmarks/${v.existing.id}`, "DELETE"));
        return null;
      }
      return (
        await json<{ bookmark: Bookmark }>(
          await send(`/api/sessions/${sessionId}/bookmarks`, "POST", {
            itemId: v.itemId,
            scope: v.scope,
          })
        )
      ).bookmark;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<Bookmark[]>(key);
      const k = bookmarkKey(v.itemId, v.scope);
      qc.setQueryData<Bookmark[]>(key, (list = []) =>
        v.existing
          ? list.filter((b) => bookmarkKey(b.itemId, b.scope) !== k)
          : [...list, placeholder(sessionId, v.itemId, v.scope)]
      );
      return { before };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.before),
    onSettled: () => qc.invalidateQueries({ queryKey: bookmarkKeys.all }),
  });
}

// Stands in for a new bookmark until the server's comes back.
const placeholder = (
  sessionId: string,
  itemId: string,
  scope: BookmarkScope
): Bookmark => ({
  id: `pending:${itemId}:${scope}`,
  sessionId,
  itemId,
  scope,
  kind: scope === "turn" ? "turn" : "user",
  text: "",
  note: null,
  sessionName: "",
  workspaceId: null,
  createdAt: new Date().toISOString(),
  state: "live",
});

export function useSetBookmarkNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; note: string | null }) =>
      (
        await json<{ bookmark: Bookmark }>(
          await send(`/api/bookmarks/${v.id}`, "PATCH", { note: v.note })
        )
      ).bookmark,
    onSettled: () => qc.invalidateQueries({ queryKey: bookmarkKeys.all }),
  });
}

export function useRemoveBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      json<{ ok: true }>(await send(`/api/bookmarks/${id}`, "DELETE")),
    onSettled: () => qc.invalidateQueries({ queryKey: bookmarkKeys.all }),
  });
}
