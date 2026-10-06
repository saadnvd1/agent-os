import { proxy, ref } from "valtio";
import type { BulkResult } from "@/lib/done/bulk";

// The Archived view: every archived session, or one workspace's, with the
// report of a clean-up that just ran on top.
export const archivedUi = proxy<{
  open: boolean;
  workspaceId: string | null;
  report: BulkResult | null;
}>({ open: false, workspaceId: null, report: null });

export const archivedUiActions = {
  open: (
    workspaceId: string | null = null,
    report: BulkResult | null = null
  ) => {
    archivedUi.workspaceId = workspaceId;
    archivedUi.report = report ? ref(report) : null;
    archivedUi.open = true;
  },
  setOpen: (open: boolean) => {
    archivedUi.open = open;
    if (!open) archivedUi.report = null;
  },
};
