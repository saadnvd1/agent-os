import { proxy, subscribe } from "valtio";

const STORAGE_KEY = "agentOS-notes";
export const NOTES_MIN_WIDTH = 280;
export const NOTES_MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

// The notes drawer. On a desktop whether it is open and how wide is kept per
// browser; the phone's sheet covers the chat, so it starts closed each load.
export const notesUi = proxy({
  open: false,
  width: DEFAULT_WIDTH,
  sheetOpen: false,
  hydrated: false,
});

export const clampNotesWidth = (w: number) =>
  Math.round(Math.min(NOTES_MAX_WIDTH, Math.max(NOTES_MIN_WIDTH, w)));

export const notesUiActions = {
  hydrate() {
    if (notesUi.hydrated || typeof window === "undefined") return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      notesUi.open = saved.open === true;
      if (typeof saved.width === "number")
        notesUi.width = clampNotesWidth(saved.width);
    } catch {}
    notesUi.hydrated = true;
    subscribe(notesUi, () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ open: notesUi.open, width: notesUi.width })
        );
      } catch {}
    });
  },
  toggle(mobile: boolean) {
    if (mobile) notesUi.sheetOpen = !notesUi.sheetOpen;
    else notesUi.open = !notesUi.open;
  },
  close(mobile: boolean) {
    if (mobile) notesUi.sheetOpen = false;
    else notesUi.open = false;
  },
  setWidth(w: number) {
    notesUi.width = clampNotesWidth(w);
  },
};
