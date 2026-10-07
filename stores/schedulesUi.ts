import { proxy } from "valtio";

// The Schedules page: one workspace's schedules, or all of them.
export const schedulesUi = proxy<{ open: boolean; workspaceId: string | null }>(
  { open: false, workspaceId: null }
);

export const schedulesUiActions = {
  open: (workspaceId: string | null = null) => {
    schedulesUi.workspaceId = workspaceId;
    schedulesUi.open = true;
  },
  setOpen: (open: boolean) => {
    schedulesUi.open = open;
  },
};
