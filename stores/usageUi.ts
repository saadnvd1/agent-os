import { proxy } from "valtio";

export type UsageTab = "spend" | "models" | "compare";

export const usageUi = proxy<{ open: boolean; tab: UsageTab }>({
  open: false,
  tab: "spend",
});

export const usageUiActions = {
  open: (tab: UsageTab = "spend") => {
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
