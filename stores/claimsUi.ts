import { proxy } from "valtio";

// The claims sheet ("Work across machines"). `focus` narrows it to the claims
// of one overlapping pair, from a row's pill.
export const claimsUi = proxy<{ open: boolean; focus: string[] | null }>({
  open: false,
  focus: null,
});

export const claimsUiActions = {
  open: (focus: string[] | null = null) => {
    claimsUi.focus = focus;
    claimsUi.open = true;
  },
  setOpen: (open: boolean) => {
    claimsUi.open = open;
    if (!open) claimsUi.focus = null;
  },
  showAll: () => {
    claimsUi.focus = null;
  },
};
