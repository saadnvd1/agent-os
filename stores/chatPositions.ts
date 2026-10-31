import { proxy } from "valtio";
import type { ChatView } from "@/lib/chat-views/types";
import type { Position } from "@/lib/nav/position";

// A place asked for and not taken this soon is stale.
const TARGET_MS = 10_000;

// What the page knows of where each chat was last read (the server's copy,
// kept current as the reader moves), a place a history entry asks a chat to
// open at, and the chats to open at their latest message.
export const chatPositions = proxy<{
  views: Record<string, ChatView>;
  loaded: boolean;
  target: { sessionId: string; pos: Position; at: number } | null;
  latest: string[];
}>({ views: {}, loaded: false, target: null, latest: [] });

export const chatPositionsActions = {
  // The server's list; what this page wrote since is newer and stays.
  hydrate: (list: ChatView[]) => {
    for (const v of list) {
      const mine = chatPositions.views[v.sessionId];
      if (!mine || mine.viewedAt < v.viewedAt)
        chatPositions.views[v.sessionId] = v;
    }
    chatPositions.loaded = true;
  },
  // The list couldn't be had: chats open at their latest, as they used to.
  giveUp: () => {
    chatPositions.loaded = true;
  },
  record: (view: ChatView) => {
    chatPositions.views[view.sessionId] = view;
  },
  setTarget: (sessionId: string, pos: Position) => {
    chatPositions.target = { sessionId, pos, at: Date.now() };
  },
  takeTarget: (sessionId: string): Position | null => {
    const t = chatPositions.target;
    if (!t || t.sessionId !== sessionId) return null;
    chatPositions.target = null;
    return Date.now() - t.at < TARGET_MS ? t.pos : null;
  },
  wantLatest: (sessionId: string) => {
    if (!chatPositions.latest.includes(sessionId))
      chatPositions.latest.push(sessionId);
  },
  takeLatest: (sessionId: string): boolean => {
    const at = chatPositions.latest.indexOf(sessionId);
    if (at === -1) return false;
    chatPositions.latest.splice(at, 1);
    return true;
  },
};
