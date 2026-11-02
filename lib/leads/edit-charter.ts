import { z } from "zod";
import { chatStateNow } from "../chat/runner";
import { CHARTER_LIMITS } from "./charter-limits";
import { putCharter } from "./charters";
import { deliverToLead } from "./deliver";
import { getLead, leadTitle } from "./home";
import type { LeadCharter } from "./types";

const text = (max: number) => z.string().max(max);

export const charterEditSchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.string().min(1),
  title: text(CHARTER_LIMITS.title)
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Title is required")),
  area: text(CHARTER_LIMITS.area).default(""),
  goal: text(CHARTER_LIMITS.goal).default(""),
  charter_md: text(CHARTER_LIMITS.charter).refine(
    (s) => s.trim().length > 0,
    "Charter is required"
  ),
});

export type CharterEdit = z.infer<typeof charterEditSchema>;

export interface CharterView {
  workspaceId: string;
  kind: string;
  title: string;
  area: string;
  goal: string;
  charter_md: string;
  updatedAt: string;
}

export const charterView = (c: LeadCharter): CharterView => ({
  workspaceId: c.workspaceId,
  kind: c.leadKind,
  title: c.title,
  area: c.areaText,
  goal: c.goal,
  charter_md: c.charterMd,
  updatedAt: c.updatedAt,
});

// Edits the charter of a lead (or the chief) the workspace has, through the
// one write path; null when it has no such lead, so a typo can't mint one.
export function editCharter(input: CharterEdit): CharterView | null {
  if (!getLead(input.workspaceId, input.kind)) return null;
  return charterView(
    putCharter({
      workspaceId: input.workspaceId,
      leadKind: input.kind,
      title: input.title,
      areaText: input.area,
      goal: input.goal,
      charterMd: input.charter_md,
    })
  );
}

const charterMessage = (c: CharterView) =>
  [
    "Your charter was updated; this replaces the previous one.",
    `Title: ${c.title}`,
    c.area.trim() && `Area: ${c.area.trim()}`,
    c.goal.trim() && `Goal: ${c.goal.trim()}`,
    c.charter_md.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

// Tells a running lead its new charter as its next prompt (queued behind a
// turn in progress, no restart). A lead with no running chat reads it from
// its brief at the next start. True when it was sent.
export async function deliverCharter(c: CharterView): Promise<boolean> {
  const lead = getLead(c.workspaceId, c.kind);
  if (!lead || !(await chatStateNow(lead.id))) return false;
  await deliverToLead(lead.id, charterMessage(c), {
    origin: {
      kind: "event",
      label: `${leadTitle(c.workspaceId, c.kind)} charter`,
    },
  });
  return true;
}
