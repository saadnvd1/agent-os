import { proxy } from "valtio";
import type { ChatContext } from "@/lib/chat/events";

// What the pane bars and the palette need from an open chat: its context
// meter, plan mode and whether a turn runs, plus what they can do to it.
export interface ChatMeta {
  context: ChatContext | null;
  // Null when the session can't use plan mode.
  plan: boolean | null;
  running: boolean;
}

export interface ChatActions {
  send: (text: string) => void;
  setPlan: (plan: boolean) => void;
  interrupt: () => void;
  focusComposer: () => void;
}

export const chatMeta = proxy<{
  sessions: Record<string, ChatMeta>;
  // The chat in the focused pane's active tab.
  active: string | null;
}>({ sessions: {}, active: null });

const actions = new Map<string, ChatActions>();

export const chatMetaActions = {
  set(sessionId: string, meta: ChatMeta) {
    const prev = chatMeta.sessions[sessionId];
    if (
      prev &&
      prev.context === meta.context &&
      prev.plan === meta.plan &&
      prev.running === meta.running
    )
      return;
    chatMeta.sessions[sessionId] = meta;
  },
  setActions(sessionId: string, a: ChatActions) {
    actions.set(sessionId, a);
  },
  remove(sessionId: string, a: ChatActions) {
    if (actions.get(sessionId) !== a) return;
    actions.delete(sessionId);
    delete chatMeta.sessions[sessionId];
  },
  actions: (sessionId: string) => actions.get(sessionId),
  setActive(sessionId: string | null) {
    chatMeta.active = sessionId;
  },
};
