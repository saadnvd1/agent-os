import type { SessionRole } from "@/lib/db/types";
import { TECH, type LeadKind } from "./types";

// Every value `sessions.role` can hold. A standing session belongs to its
// workspace and lives until archived: it is never swept as idle, shown as
// done, or counted as a worker.
export const STANDING_ROLES = [
  "orchestrator",
  "lead",
  "chief",
] as const satisfies readonly SessionRole[];

export function isStandingRole(
  role: string | null | undefined
): role is SessionRole {
  return (STANDING_ROLES as readonly string[]).includes(role ?? "");
}

// A department head: the orchestrator (Tech) or another lead.
export const isLeadRole = (role: string | null | undefined): boolean =>
  role === "orchestrator" || role === "lead";

// The department a standing session heads: the orchestrator is always Tech,
// even before its workspace adds leads; the chief heads none.
export function leadKindOf(s: {
  role: string | null;
  lead_kind?: string | null;
}): LeadKind | null {
  if (s.role === "orchestrator") return TECH;
  if (s.role === "lead") return s.lead_kind ?? null;
  return null;
}

const SLUG = /^[a-z][a-z0-9-]{0,31}$/;

export const isLeadKind = (v: unknown): v is LeadKind =>
  typeof v === "string" && SLUG.test(v);
