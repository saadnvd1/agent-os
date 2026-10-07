import { proxy, ref } from "valtio";

// Opens the form filled in, like "Schedule check-ins" on a session.
export interface ScheduleDraft {
  kind: "message";
  targetSessionId: string;
  name: string;
}

// The Schedules page: one workspace's schedules, or all of them.
export const schedulesUi = proxy<{
  open: boolean;
  workspaceId: string | null;
  draft: ScheduleDraft | null;
}>({ open: false, workspaceId: null, draft: null });

export const schedulesUiActions = {
  open: (workspaceId: string | null = null) => {
    schedulesUi.workspaceId = workspaceId;
    schedulesUi.draft = null;
    schedulesUi.open = true;
  },
  openDraft: (workspaceId: string | null, draft: ScheduleDraft) => {
    schedulesUi.workspaceId = workspaceId;
    schedulesUi.draft = ref(draft);
    schedulesUi.open = true;
  },
  clearDraft: () => {
    schedulesUi.draft = null;
  },
  setOpen: (open: boolean) => {
    schedulesUi.open = open;
    if (!open) schedulesUi.draft = null;
  },
};
