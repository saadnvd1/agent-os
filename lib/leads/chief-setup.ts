// The chief's workspace-setup tools: add a lead and rewrite a charter, the
// same code paths as the "Add leads" sheet and the charter editor.

import { PAUSED_REFUSAL } from "../orchestrator/pause";
import { getWorkspace } from "../workspaces";
import { getCharter, putCharter } from "./charters";
import { charterEditSchema, deliverCharter, editCharter } from "./edit-charter";
import { addLeads, checkKinds, getLead, leadTitle } from "./home";
import { CHIEF } from "./order";
import { isLeadKind } from "./roles";

const refuseWhenPaused = (w: string) => {
  if (getWorkspace(w)?.orch_paused_at) throw new Error(PAUSED_REFUSAL);
};

export function addLeadTool(
  w: string,
  args: { kind: string; title?: string }
): string {
  refuseWhenPaused(w);
  const kind = args.kind.toLowerCase();
  const existed = !!getLead(w, kind);
  addLeads(w, checkKinds([kind]));
  const lead = getLead(w, kind);
  if (!lead)
    throw new Error("Tech already exists; edit it with update_charter");
  const charter = getCharter(w, kind);
  if (!existed && args.title && charter)
    putCharter({ ...charter, title: args.title });
  return existed
    ? `The ${leadTitle(w, kind)} already exists; nothing added. Change its charter with update_charter.`
    : `Added the ${leadTitle(w, kind)} (kind "${kind}") with a starting charter. Rewrite it with update_charter, and message_lead reaches it.`;
}

export async function updateCharterTool(
  w: string,
  args: {
    lead: string;
    title?: string;
    area?: string;
    goal?: string;
    charter_md?: string;
  }
): Promise<string> {
  refuseWhenPaused(w);
  const kind = args.lead.toLowerCase();
  if (kind === CHIEF || !isLeadKind(kind) || !getLead(w, kind))
    throw new Error(
      `This workspace has no "${args.lead}" lead; add_lead makes one`
    );
  const current = getCharter(w, kind);
  const parsed = charterEditSchema.safeParse({
    workspaceId: w,
    kind,
    title: args.title ?? current?.title ?? "",
    area: args.area ?? current?.areaText ?? "",
    goal: args.goal ?? current?.goal ?? "",
    charter_md: args.charter_md ?? current?.charterMd ?? "",
  });
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid charter");
  const charter = editCharter(parsed.data);
  if (!charter) throw new Error(`No charter for "${kind}"`);
  const told = await deliverCharter(charter).catch(() => false);
  return `Updated the ${charter.title} charter. ${
    told
      ? "Its running chat was told."
      : "It isn't running; it reads the charter at its next start."
  }`;
}
