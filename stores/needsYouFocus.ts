import { proxy } from "valtio";

// "Show this ask", raised by the Needs-you strip and the Inbox and handled
// by the asks list above the chat, which opens itself and scrolls the card
// into view. "Reply to this question" is handled by the orchestrator's chat.
export const needsYouFocus = proxy<{
  ask: { id: number; at: number } | null;
  reply: { workspaceId: string; id: number; text: string; at: number } | null;
}>({ ask: null, reply: null });

export const needsYouFocusActions = {
  ask: (id: number) => {
    needsYouFocus.ask = { id, at: Date.now() };
  },
  reply: (workspaceId: string, id: number, text: string) => {
    needsYouFocus.reply = { workspaceId, id, text, at: Date.now() };
  },
  clearReply: () => {
    needsYouFocus.reply = null;
  },
};
