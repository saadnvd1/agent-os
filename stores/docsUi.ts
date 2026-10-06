import { proxy } from "valtio";

// The Docs dialog: which linked workspace it shows, and the page being read.
export const docsUi = proxy({
  workspaceId: null as string | null,
  pageId: null as string | null,
});

export const docsUiActions = {
  open: (workspaceId: string) => {
    docsUi.workspaceId = workspaceId;
    docsUi.pageId = null;
  },
  close: () => {
    docsUi.workspaceId = null;
    docsUi.pageId = null;
  },
  read: (pageId: string | null) => {
    docsUi.pageId = pageId;
  },
};
