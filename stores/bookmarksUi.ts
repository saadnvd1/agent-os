import { proxy } from "valtio";

// The Bookmarks views: every chat's (`open`, one workspace's or all), or one
// chat's (`chatSessionId`); the bookmark whose note is being written; and a
// jump waiting for its chat to be on screen.
export const bookmarksUi = proxy<{
  open: boolean;
  workspaceId: string | null;
  chatSessionId: string | null;
  editing: string | null;
  jump: { sessionId: string; itemId: string; at: number } | null;
}>({
  open: false,
  workspaceId: null,
  chatSessionId: null,
  editing: null,
  jump: null,
});

export const bookmarksUiActions = {
  open: (workspaceId: string | null = null) => {
    bookmarksUi.workspaceId = workspaceId;
    bookmarksUi.open = true;
  },
  setOpen: (open: boolean) => {
    bookmarksUi.open = open;
    if (!open) bookmarksUi.editing = null;
  },
  openChat: (sessionId: string, editing: string | null = null) => {
    bookmarksUi.editing = editing;
    bookmarksUi.chatSessionId = sessionId;
  },
  closeChat: () => {
    bookmarksUi.chatSessionId = null;
    bookmarksUi.editing = null;
  },
  edit: (id: string | null) => {
    bookmarksUi.editing = id;
  },
  jump: (sessionId: string, itemId: string) => {
    bookmarksUi.jump = { sessionId, itemId, at: Date.now() };
  },
  // The chat showing it takes the jump; one taken isn't taken twice.
  takeJump: (sessionId: string): string | null => {
    const j = bookmarksUi.jump;
    if (!j || j.sessionId !== sessionId) return null;
    bookmarksUi.jump = null;
    return j.itemId;
  },
};
