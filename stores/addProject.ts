import { proxy } from "valtio";

export type AddProjectKind = "folder" | "clone" | "name";

// The add-project form on show, once a machine and a way are picked.
export const addProjectUi = proxy<{
  open: { kind: AddProjectKind; hostId: string } | null;
}>({ open: null });

export const addProjectActions = {
  show: (kind: AddProjectKind, hostId: string) => {
    addProjectUi.open = { kind, hostId };
  },
  close: () => {
    addProjectUi.open = null;
  },
};
