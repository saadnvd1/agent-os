import { proxy } from "valtio";

export const usageUi = proxy({ open: false });

export const usageUiActions = {
  open: () => {
    usageUi.open = true;
  },
  setOpen: (open: boolean) => {
    usageUi.open = open;
  },
};
