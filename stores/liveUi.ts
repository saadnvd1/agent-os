import { proxy } from "valtio";

// The invite dialog: which chat it is open on, started from a menu.
export const liveUi = proxy<{
  target: { sessionId: string; title: string } | null;
}>({
  target: null,
});

export const liveUiActions = {
  open: (sessionId: string, title: string) => {
    liveUi.target = { sessionId, title };
  },
  close: () => {
    liveUi.target = null;
  },
};
