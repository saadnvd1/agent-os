/**
 * A workspace's leads: durable chat sessions run like its orchestrator, each
 * heading one department. The orchestrator is the Tech lead in place (same
 * row, same data); the others are rows with the lead role, made by "Add leads"
 * or adopted from an existing chat (./adopt).
 */

import fs from "fs";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { db, type Session } from "../db";
import { agentosHome } from "../agentos-home";
import { refuseRealStateUnderTest } from "../test-home-guard";
import { getWorkspace } from "../workspaces";
import { resolveRoleOrDefault } from "../models/resolve";
import {
  ensureOrchestrator,
  getOrchestrator,
  orchestratorDir,
} from "../orchestrator/home";
import { isLeadKind, leadKindOf, sqlLead, sqlStanding } from "./roles";
import { TECH, type LeadKind } from "./types";
import { markLeadsEnabled } from "./settings";
import { getCharter, leadAreas, putCharter } from "./charters";
import { charterTemplate } from "./templates";

// Tech first, then the shipped kinds, then custom ones by name.
const ORDER = [TECH, "marketing", "product"];
const rank = (kind: string) => {
  const i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length : i;
};
export const byLeadOrder = (a: string, b: string) =>
  rank(a) - rank(b) || a.localeCompare(b);

// Where a lead starts and may write freely: the Tech lead keeps the
// orchestrator's folder.
export const leadDir = (workspaceId: string, kind: LeadKind) =>
  kind === TECH
    ? orchestratorDir(workspaceId)
    : refuseRealStateUnderTest(agentosHome("leads", workspaceId, kind));

// A standing session's own folder, whatever its role.
export const standingDir = (
  s: Pick<Session, "role" | "lead_kind" | "workspace_id">
) => leadDir(s.workspace_id ?? "", leadKindOf(s) ?? "chief");

export function getLead(workspaceId: string, kind: LeadKind): Session | null {
  if (kind === TECH) return getOrchestrator(workspaceId);
  return (
    (db
      .prepare(
        `SELECT * FROM session_rows WHERE ${sqlLead()} AND workspace_id = ? AND lead_kind = ?`
      )
      .get(workspaceId, kind) as Session | undefined) ?? null
  );
}

// The workspace's heads: its orchestrator (Tech) and its other leads.
export function listLeads(workspaceId: string): Session[] {
  const rows = db
    .prepare(
      `SELECT * FROM session_rows
       WHERE workspace_id = ? AND ${sqlLead()}`
    )
    .all(workspaceId) as Session[];
  return rows.sort((a, b) =>
    byLeadOrder(leadKindOf(a) ?? "", leadKindOf(b) ?? "")
  );
}

export function leadTitle(workspaceId: string, kind: LeadKind): string {
  return getCharter(workspaceId, kind)?.title || charterTemplate(kind).title;
}

// A lead starts from the generic charter for its kind; one already written
// (by the person, in their own database) is never overwritten.
export function seedCharter(workspaceId: string, kind: LeadKind): void {
  if (getCharter(workspaceId, kind)) return;
  const t = charterTemplate(kind);
  putCharter({ workspaceId, leadKind: kind, ...t });
}

// Marks the orchestrator as the Tech lead, once.
function claimTech(workspaceId: string): Session {
  const tech = ensureOrchestrator(workspaceId);
  db.prepare(
    `UPDATE sessions SET lead_kind = 'tech', lead_since = COALESCE(lead_since, datetime('now'))
     WHERE id = ?`
  ).run(tech.id);
  seedCharter(workspaceId, TECH);
  return getOrchestrator(workspaceId)!;
}

function createLead(workspaceId: string, kind: LeadKind): Session {
  const existing = getLead(workspaceId, kind);
  if (existing) return existing;
  const workspace = getWorkspace(workspaceId)!;
  seedCharter(workspaceId, kind);
  const dir = leadDir(workspaceId, kind);
  fs.mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  // Two at once still make one: the unique (workspace, kind) index decides.
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, name, tmux_name, working_directory, model,
       group_path, agent_type, auto_approve, project_id, host_id, view, chat_access,
       role, lead_kind, lead_since, workspace_id, pinned)
     VALUES (?, ?, ?, ?, ?, 'sessions', 'claude', 0, NULL, 'local', 'chat', 'ask',
       'lead', ?, datetime('now'), ?, 1)`
  ).run(
    id,
    `${workspace.name} ${leadTitle(workspaceId, kind)}`,
    `claude-${id}`,
    dir,
    resolveRoleOrDefault("orchestrator", { workspaceId }).model,
    kind,
    workspaceId
  );
  return getLead(workspaceId, kind)!;
}

export function checkKinds(kinds: unknown): LeadKind[] {
  if (!Array.isArray(kinds) || !kinds.every(isLeadKind))
    throw new Error(
      "Each lead is a short lowercase name: letters, digits and dashes"
    );
  return [...new Set(kinds)].filter((k) => k !== TECH);
}

// "Add leads": the workspace gets its Tech lead (its orchestrator, made if
// it has none) and the leads picked. Safe to run again; nothing made twice.
export function addLeads(workspaceId: string, kinds: LeadKind[]): Session[] {
  if (!getWorkspace(workspaceId)) throw new Error("Unknown workspace");
  const picked = checkKinds(kinds);
  markLeadsEnabled(workspaceId);
  claimTech(workspaceId);
  for (const kind of picked) createLead(workspaceId, kind);
  return listLeads(workspaceId);
}

// The secret a standing session's worker sends with each tool call, so no
// other local process can act as it. The orchestrator's is the one it
// always had.
export function standingToken(sessionId: string): string {
  db.prepare(
    `UPDATE sessions SET orch_token = COALESCE(orch_token, ?) WHERE id = ?`
  ).run(randomBytes(32).toString("hex"), sessionId);
  const row = db
    .prepare(`SELECT orch_token FROM sessions WHERE id = ?`)
    .get(sessionId) as { orch_token: string | null } | undefined;
  if (!row?.orch_token) throw new Error("No such session");
  return row.orch_token;
}

// Which of the workspace's standing sessions holds this token, if any.
export function standingByToken(
  workspaceId: string,
  token: string | null
): Session | null {
  if (!token) return null;
  const b = Buffer.from(token);
  const rows = db
    .prepare(
      `SELECT * FROM session_rows
       WHERE workspace_id = ? AND ${sqlStanding()} AND orch_token IS NOT NULL`
    )
    .all(workspaceId) as Session[];
  let found: Session | null = null;
  for (const s of rows) {
    const a = Buffer.from(s.orch_token!);
    if (a.length === b.length && timingSafeEqual(a, b)) found = s;
  }
  return found;
}

export interface LeadView {
  kind: LeadKind;
  title: string;
  sessionId: string;
  name: string;
  since: string | null;
  areas: { kind: string; value: string }[];
}

export function leadViews(workspaceId: string): LeadView[] {
  return listLeads(workspaceId).map((s) => {
    const kind = leadKindOf(s) ?? TECH;
    return {
      kind,
      title: leadTitle(workspaceId, kind),
      sessionId: s.id,
      name: s.name,
      since: s.lead_since ?? null,
      areas: leadAreas(workspaceId, kind),
    };
  });
}
