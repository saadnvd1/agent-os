import { proxy } from "valtio";

export const busUi = proxy({ open: false });

export const busUiActions = {
  setOpen: (open: boolean) => {
    busUi.open = open;
  },
  open: () => {
    busUi.open = true;
  },
};
