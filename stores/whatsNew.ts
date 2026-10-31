import { proxy } from "valtio";

// Whether the What's New dialog is open, so the footer row and the update
// banner can both open the one dialog. `preview` opens it showing what a
// waiting update would add.
export const whatsNewStore = proxy({ open: false, preview: false });

export const whatsNewActions = {
  open: (preview = false) => {
    whatsNewStore.preview = preview;
    whatsNewStore.open = true;
  },
  close: () => {
    whatsNewStore.open = false;
  },
};
