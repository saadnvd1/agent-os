import { proxy } from "valtio";

export type UsageTab = "daily" | "spend" | "models" | "compare";

export const usageUi = proxy<{ open: boolean; tab: UsageTab }>({
  open: false,
  tab: "daily",
});

export const usageUiActions = {
  open: (tab: UsageTab = "daily") => {
    usageUi.tab = tab;
    usageUi.open = true;
  },
  setOpen: (open: boolean) => {
    usageUi.open = open;
  },
  setTab: (tab: UsageTab) => {
    usageUi.tab = tab;
  },
};
