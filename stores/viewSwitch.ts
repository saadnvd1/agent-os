import { proxy } from "valtio";

// A request to show a session as chat or as a terminal; the page carries it
// out because it owns the terminals.
export const viewSwitchStore = proxy<{
  request: { sessionId: string; view: "chat" | "terminal" } | null;
}>({ request: null });

export const viewSwitchActions = {
  request: (sessionId: string, view: "chat" | "terminal") => {
    viewSwitchStore.request = { sessionId, view };
  },
  clear: () => {
    viewSwitchStore.request = null;
  },
};
