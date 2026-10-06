import { proxy } from "valtio";

// Open state for the task dialogs, shared by the header and the sidebar menu.
export const tasksUi = proxy({ panelOpen: false, newOpen: false });

export const tasksUiActions = {
  openPanel: () => {
    tasksUi.panelOpen = true;
  },
  setPanelOpen: (open: boolean) => {
    tasksUi.panelOpen = open;
  },
  openNew: () => {
    tasksUi.newOpen = true;
  },
  closeNew: () => {
    tasksUi.newOpen = false;
  },
  started: () => {
    tasksUi.newOpen = false;
    tasksUi.panelOpen = true;
  },
};
