import { proxy } from "valtio";

// The Tasks panel's open state, shared by the header and the sidebar menu.
// A new task is a draft with "Open a PR when done" (stores/drafts).
export const tasksUi = proxy({ panelOpen: false });

export const tasksUiActions = {
  openPanel: () => {
    tasksUi.panelOpen = true;
  },
  setPanelOpen: (open: boolean) => {
    tasksUi.panelOpen = open;
  },
};
