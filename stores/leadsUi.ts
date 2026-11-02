import { proxy } from "valtio";

// The "Add leads" sheet (a workspace, with a lead already ticked when opened
// from its dashed row) and the "Adopt as lead" dialog (one chat).
export const leadsUi = proxy<{
  add: { workspaceId: string; kind: string | null } | null;
  adopt: { sessionId: string; name: string; workspaceId: string } | null;
}>({ add: null, adopt: null });

export const leadsUiActions = {
  openAdd(workspaceId: string, kind: string | null = null) {
    leadsUi.add = { workspaceId, kind };
  },
  openAdopt(sessionId: string, name: string, workspaceId: string) {
    leadsUi.adopt = { sessionId, name, workspaceId };
  },
  close() {
    leadsUi.add = null;
    leadsUi.adopt = null;
  },
};
