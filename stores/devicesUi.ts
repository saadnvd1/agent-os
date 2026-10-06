import { proxy } from "valtio";

export const devicesUi = proxy({ open: false });

export const devicesUiActions = {
  setOpen: (open: boolean) => {
    devicesUi.open = open;
  },
  open: () => {
    devicesUi.open = true;
  },
};
