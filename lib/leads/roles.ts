import type { SessionRole } from "@/lib/db/types";
import { TECH, type LeadKind } from "./types";

// Client-safe: no database. Every check of `sessions.role` goes through one of
// the decisions below (role-sites.test.ts fails on a raw one), and each
// decision is a table over every role, so a new role can't be added without
// deciding it everywhere.

type RoleTable<T> = Readonly<Record<SessionRole | "none", T>>;

const decide =
  (t: RoleTable<boolean>) =>
  (role: string | null | undefined): boolean =>
    (t as Record<string, boolean>)[role ?? "none"] ?? false;

// Every value `sessions.role` can hold. A standing session belongs to its
// workspace and lives until its workspace goes: it is never swept as idle,
// shown as done, archived, forked, moved or counted as a worker, and it
// starts fresh rather than compacting.
export const STANDING_ROLES = [
  "orchestrator",
  "lead",
  "chief",
] as const satisfies readonly SessionRole[];

const STANDING: RoleTable<boolean> = {
  none: false,
  orchestrator: true,
  lead: true,
  chief: true,
};

// The workspace's orchestrator, which is its Tech lead: the one head that
// lands code (sign-off, arming, merges), owns the workspace's own schedule
// kind and is what "orchestrator" names on the bus. Also the orchestrator's
// own machinery (its tools, brief and Needs-you bar) until a lead gets a
// profile of its own.
const TECH_ROLE: RoleTable<boolean> = {
  none: false,
  orchestrator: true,
  lead: false,
  chief: false,
};

// A department head: the orchestrator (Tech) or another lead.
const LEAD: RoleTable<boolean> = {
  none: false,
  orchestrator: true,
  lead: true,
  chief: false,
};

export const ROLE_DECISIONS = {
  standing: STANDING,
  tech: TECH_ROLE,
  lead: LEAD,
} as const;

export const isStandingRole = decide(STANDING) as (
  role: string | null | undefined
) => role is SessionRole;
export const isTechRole = decide(TECH_ROLE);
export const isLeadRole = decide(LEAD);

const NOUN: RoleTable<string> = {
  none: "session",
  orchestrator: "orchestrator",
  lead: "lead",
  chief: "chief of staff",
};

// "orchestrator", "lead": for refusals that name what a session is.
export const roleNoun = (role: string | null | undefined): string =>
  (NOUN as Record<string, string>)[role ?? "none"] ?? NOUN.none;
export const roleLabel = (role: string | null | undefined): string => {
  const n = roleNoun(role);
  return `${/^[aeiou]/.test(n) ? "an" : "a"} ${n}`;
};
export const RoleLabel = (role: string | null | undefined): string => {
  const l = roleLabel(role);
  return l[0].toUpperCase() + l.slice(1);
};

// The same decisions in SQL, for a column holding `sessions.role`. Every
// role value is standing, so "no role" is the plain worker.
const SQL_ROLES = STANDING_ROLES.map((r) => `'${r}'`).join(", ");
export const sqlStanding = (col = "role") => `${col} IN (${SQL_ROLES})`;
export const sqlNoRole = (col = "role") => `${col} IS NULL`;
export const sqlTech = (col = "role") => `${col} = 'orchestrator'`;
const SQL_LEADS = STANDING_ROLES.filter((r) => LEAD[r])
  .map((r) => `'${r}'`)
  .join(", ");
export const sqlLead = (col = "role") => `${col} IN (${SQL_LEADS})`;

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

// A linked machine may run a newer AgentOS with roles this one doesn't know:
// any role it reports is standing there.
export const isPeerStanding = (role: unknown): boolean =>
  typeof role === "string" ? role !== "" : role != null;
