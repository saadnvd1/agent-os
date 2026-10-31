import { proxy } from "valtio";

// The shortcuts panel, and the first key of a sequence that is waiting for
// its second (shown as a chip so the reader sees it was heard).
export const shortcutsUi = proxy<{ open: boolean; pending: string | null }>({
  open: false,
  pending: null,
});

export const shortcutsUiActions = {
  open: () => {
    shortcutsUi.open = true;
  },
  setOpen: (open: boolean) => {
    shortcutsUi.open = open;
  },
  setPending: (key: string | null) => {
    shortcutsUi.pending = key;
  },
};
