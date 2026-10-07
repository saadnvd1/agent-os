import { proxy } from "valtio";

export const phoneNotifyUi = proxy({ open: false });

export const phoneNotifyUiActions = {
  setOpen: (open: boolean) => {
    phoneNotifyUi.open = open;
  },
};
