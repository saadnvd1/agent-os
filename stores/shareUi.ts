import { proxy } from "valtio";
import type { ShareTarget } from "@/data/shares";

// What the share dialog is open on: a chat or an artifact, started from a
// menu, the pane or the artifact card.
export const shareUi = proxy<{
  target: (ShareTarget & { title: string }) | null;
}>({ target: null });

export const shareUiActions = {
  open: (target: ShareTarget & { title: string }) => {
    shareUi.target = target;
  },
  close: () => {
    shareUi.target = null;
  },
};
