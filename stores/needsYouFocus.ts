import { proxy } from "valtio";

// "Show this ask", raised by the Needs-you strip and handled by the asks list
// above the chat, which opens itself and scrolls the card into view.
export const needsYouFocus = proxy<{
  ask: { id: number; at: number } | null;
}>({ ask: null });

export const needsYouFocusActions = {
  ask: (id: number) => {
    needsYouFocus.ask = { id, at: Date.now() };
  },
};
