import { proxy } from "valtio";

// Which LumifyHub dialog is open. One host renders them all, so the sidebar
// rows only flip these.
export const lumifyhubUi = proxy({
  connectOpen: false,
  linkWorkspaceId: null as string | null,
  linkBoardProjectId: null as string | null,
});

export const lumifyhubUiActions = {
  openConnect: () => {
    lumifyhubUi.connectOpen = true;
  },
  closeConnect: () => {
    lumifyhubUi.connectOpen = false;
  },
  openWorkspaceLink: (id: string) => {
    lumifyhubUi.linkWorkspaceId = id;
  },
  closeWorkspaceLink: () => {
    lumifyhubUi.linkWorkspaceId = null;
  },
  openBoardLink: (projectId: string) => {
    lumifyhubUi.linkBoardProjectId = projectId;
  },
  closeBoardLink: () => {
    lumifyhubUi.linkBoardProjectId = null;
  },
};
