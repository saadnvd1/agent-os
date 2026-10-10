import { proxy, ref } from "valtio";
import { settingsUiActions } from "./settingsUi";

// Opens the form filled in, like "Schedule check-ins" on a session.
export interface ScheduleDraft {
  kind: "message";
  targetSessionId: string;
  name: string;
}

// Settings > Schedules: one workspace's schedules, or all of them.
export const schedulesUi = proxy<{
  workspaceId: string | null;
  draft: ScheduleDraft | null;
}>({ workspaceId: null, draft: null });

export const schedulesUiActions = {
  open: (workspaceId: string | null = null) => {
    schedulesUi.workspaceId = workspaceId;
    schedulesUi.draft = null;
    settingsUiActions.open("schedules");
  },
  openDraft: (workspaceId: string | null, draft: ScheduleDraft) => {
    schedulesUi.workspaceId = workspaceId;
    schedulesUi.draft = ref(draft);
    settingsUiActions.open("schedules");
  },
  clearDraft: () => {
    schedulesUi.draft = null;
  },
};
