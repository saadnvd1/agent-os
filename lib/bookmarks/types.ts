// A person's mark on one chat item, shared by the routes, the web app and
// the native app.

export type BookmarkScope = "item" | "turn";
export type BookmarkKind = "user" | "assistant" | "tool" | "turn";
// live: the chat is there; archived: it is, archived; moved: this row is the
// copy left behind by a move; deleted: the chat is gone, the snapshot stays.
export type BookmarkState = "live" | "archived" | "moved" | "deleted";

export interface Bookmark {
  id: string;
  sessionId: string;
  itemId: string;
  scope: BookmarkScope;
  kind: BookmarkKind;
  text: string;
  note: string | null;
  sessionName: string;
  workspaceId: string | null;
  createdAt: string;
  state: BookmarkState;
}

export interface BookmarksPage {
  bookmarks: Bookmark[];
  // Pass as `before` for the next page; null on the last one.
  next: string | null;
}

export const BOOKMARKABLE_KINDS = ["user", "assistant", "tool"] as const;

export const MAX_NOTE_CHARS = 500;
// A snapshot is clipped to this, plus the ellipsis that marks the cut.
export const MAX_SNAPSHOT_CHARS = 4_000;

// The key the stars look a bookmark up by.
export const bookmarkKey = (itemId: string, scope: BookmarkScope) =>
  `${itemId}:${scope}`;
