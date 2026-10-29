import { proxy } from "valtio";
import type { ShareTarget } from "@/data/shares";

// What the share dialog is open on: a chat or an artifact, started from a
// menu, the pane or the artifact card.
// A page's version, when it has more than one, is named in the title; the
// share is of that exact version.
// A chat share can start from one message ("Share from here").
export type ShareUiTarget = ShareTarget & {
  title: string;
  version?: number;
  fromId?: string;
};

export const shareUi = proxy<{
  target: ShareUiTarget | null;
}>({ target: null });

export const shareUiActions = {
  open: (target: ShareUiTarget) => {
    shareUi.target = target;
  },
  close: () => {
    shareUi.target = null;
  },
};
