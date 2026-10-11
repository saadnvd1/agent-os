import { proxy } from "valtio";
import { sidebarUi } from "./sidebarUi";

export type AddProjectKind = "folder" | "clone" | "name";

// The add-project form on show, once a machine and a way are picked. It
// adds to the workspace the sidebar is on, changeable in the form.
export const addProjectUi = proxy<{
  open: {
    kind: AddProjectKind;
    hostId: string;
    workspaceId: string | null;
  } | null;
}>({ open: null });

export const addProjectActions = {
  show: (kind: AddProjectKind, hostId: string) => {
    addProjectUi.open = { kind, hostId, workspaceId: sidebarUi.workspaceId };
  },
  setWorkspace: (workspaceId: string | null) => {
    if (addProjectUi.open) addProjectUi.open.workspaceId = workspaceId;
  },
  close: () => {
    addProjectUi.open = null;
  },
};
