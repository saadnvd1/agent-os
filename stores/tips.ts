import { proxy } from "valtio";

// Whether the Tip of the Day dialog is open, so the sidebar icon can open
// the one dialog mounted near the top of the app.
export const tipsStore = proxy({ open: false });

export const tipsActions = {
  open: () => {
    tipsStore.open = true;
  },
  close: () => {
    tipsStore.open = false;
  },
};
