import { proxy } from "valtio";

export const mergeUi = proxy({ open: false });

export const mergeUiActions = {
  setOpen: (open: boolean) => {
    mergeUi.open = open;
  },
  open: () => {
    mergeUi.open = true;
  },
};
