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

// Who asked for the dialog and wants the new project instead of the draft
// that opens in it. A function, so it stays out of the proxy.
let onProjectAdded: ((projectId: string) => void) | null = null;

export const addProjectActions = {
  show: (
    kind: AddProjectKind,
    hostId: string,
    onDone?: (projectId: string) => void
  ) => {
    onProjectAdded = onDone ?? null;
    addProjectUi.open = { kind, hostId, workspaceId: sidebarUi.workspaceId };
  },
  /** Called once a project is made; false if nobody took it over. */
  finish: (projectId: string): boolean => {
    const handler = onProjectAdded;
    addProjectActions.close();
    if (!handler) return false;
    handler(projectId);
    return true;
  },
  setWorkspace: (workspaceId: string | null) => {
    if (addProjectUi.open) addProjectUi.open.workspaceId = workspaceId;
  },
  close: () => {
    onProjectAdded = null;
    addProjectUi.open = null;
  },
};
