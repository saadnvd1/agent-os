import { proxy } from "valtio";

// The Add analyst sheet: the chat it pairs with, and the pane to open the
// analyst beside.
export const analystUi = proxy<{
  open: boolean;
  sessionId: string | null;
  name: string;
  paneId: string | null;
}>({ open: false, sessionId: null, name: "", paneId: null });

export const analystUiActions = {
  open(sessionId: string, name: string, paneId: string | null = null) {
    Object.assign(analystUi, { open: true, sessionId, name, paneId });
  },
  close() {
    analystUi.open = false;
  },
};
