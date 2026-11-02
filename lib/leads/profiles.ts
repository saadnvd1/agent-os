// What each kind of lead may do: one profile per kind, applied where the
// orchestrator's tools are built (orchestrator/worker.ts) and enforced again
// by the server on every call (./tools.ts). Tool bodies stay where they are.

import type { Session } from "@/lib/db/types";
import { TOOLS, type ToolName } from "../orchestrator/tool-schemas";
import { isLeadRole, isTechRole } from "./roles";
import type { LeadKind } from "./types";
import { TECH } from "./types";

// A lead's own tools, on top of the orchestrator's (./tools.ts).
export const LEAD_TOOLS = ["update_memo", "propose_pin", "direction"] as const;
export type LeadToolName = (typeof LEAD_TOOLS)[number];
export const isLeadToolName = (t: unknown): t is LeadToolName =>
  typeof t === "string" && (LEAD_TOOLS as readonly string[]).includes(t);

// Only the Tech lead has these. Landing code is one head's job: reviews,
// merges, arming, landing stacks and its own quick changes. So are the
// machine (disk clean-up, moving tasks), the workspace's projects and tiers,
// other workspaces, its standing rules, reminders and open questions, and
// starting past the running-task limit.
export const TECH_ONLY: ReadonlySet<ToolName> = new Set<ToolName>([
  "review",
  "sign_off",
  "arm",
  "disarm",
  "land",
  "done",
  "quick_change",
  "quick_pr",
  "move",
  "sweep_dry_run",
  "sweep_arm",
  "add_project",
  "project_tier",
  "orchestrators",
  "message_orchestrator",
  "rule_add",
  "rule_remove",
  "remind_me",
  "reminders",
  "cancel_reminder",
  "question",
  "resolve_question",
  "start_now",
  "recipe_save",
  "recipe_update",
]);

export interface Profile {
  kind: LeadKind;
  tools: readonly ToolName[];
  leadTools: readonly LeadToolName[];
  // Starts and stops only inside its area (./area.ts).
  inArea: boolean;
}

// A standing session's profile, or null for one that has none yet (the
// chief, piece 7). The orchestrator of a workspace without leads keeps
// exactly the tools it always had.
export function profileFor(
  s: Pick<Session, "role" | "lead_kind">,
  workspaceHasLeads: boolean
): Profile | null {
  if (isTechRole(s.role))
    return {
      kind: TECH,
      tools: TOOLS,
      leadTools: workspaceHasLeads ? LEAD_TOOLS : [],
      inArea: false,
    };
  if (!isLeadRole(s.role) || !s.lead_kind) return null;
  return {
    kind: s.lead_kind,
    tools: TOOLS.filter((t) => !TECH_ONLY.has(t)),
    leadTools: LEAD_TOOLS,
    inArea: true,
  };
}

export const profileHas = (p: Profile, tool: string): boolean =>
  (p.tools as readonly string[]).includes(tool) ||
  (p.leadTools as readonly string[]).includes(tool);
