/**
 * What the "Add leads" sheet shows for one workspace: each shipped kind with
 * its generic template and whether the workspace has it, its custom leads,
 * and the chats here that could be adopted instead of starting a new one.
 */

import { z } from "zod";
import { db, type Session } from "../db";
import { getWorkspace } from "../workspaces";
import { getOrchestrator } from "../orchestrator/home";
import { experimentOn } from "../experiments";
import { getLead, leadTitle, listLeads } from "./home";
import { hasLeads } from "./settings";
import { leadKindOf, sqlNoRole } from "./roles";
import { charterTemplate } from "./templates";
import { adoptRefusal } from "./adoptable";
import { BUILT_IN_KINDS, TECH, type LeadKind } from "./types";

// How many of the workspace's chats the sheet offers to adopt.
const CANDIDATES = 25;

export const SetupQuery = z.object({ workspaceId: z.string().min(1) });

export interface LeadChoice {
  kind: LeadKind;
  title: string;
  areaText: string;
  sessionId: string | null;
}

export interface AdoptCandidate {
  sessionId: string;
  name: string;
  // The shipped kind its name points at ("Marketing lead" -> marketing).
  suggest: LeadKind | null;
}

export interface LeadSetupView {
  workspaceId: string;
  workspace: string;
  enabled: boolean;
  hasLeads: boolean;
  hasOrchestrator: boolean;
  choices: LeadChoice[];
  custom: LeadChoice[];
  candidates: AdoptCandidate[];
}

const choice = (workspaceId: string, kind: LeadKind): LeadChoice => ({
  kind,
  title: leadTitle(workspaceId, kind),
  areaText: charterTemplate(kind).areaText,
  sessionId: getLead(workspaceId, kind)?.id ?? null,
});

// A chat's name names a kind when it holds the kind as a word.
export function suggestKind(
  name: string,
  open: readonly LeadKind[]
): LeadKind | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/);
  return open.find((k) => words.includes(k)) ?? null;
}

function candidates(
  workspaceId: string,
  open: readonly LeadKind[]
): AdoptCandidate[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM session_rows s LEFT JOIN projects p ON p.id = s.project_id
       WHERE COALESCE(s.workspace_id, p.workspace_id) = ? AND ${sqlNoRole("s.role")}
         AND s.view = 'chat' AND s.agent_type = 'claude'
         AND s.task_status IS NULL AND s.worktree_path IS NULL
         AND s.archived_at IS NULL
       ORDER BY s.pinned DESC, COALESCE(s.active_at, s.updated_at) DESC
       LIMIT ?`
    )
    .all(workspaceId, CANDIDATES) as Session[];
  return rows
    .filter((s) => !adoptRefusal(s))
    .map((s) => ({
      sessionId: s.id,
      name: s.name,
      suggest: suggestKind(s.name, open),
    }));
}

export function leadSetup(workspaceId: string): LeadSetupView | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const choices = BUILT_IN_KINDS.map((k) => choice(workspaceId, k));
  const shipped = new Set<string>(BUILT_IN_KINDS);
  const custom = listLeads(workspaceId)
    .map((s) => leadKindOf(s))
    .filter((k): k is LeadKind => !!k && !shipped.has(k))
    .map((k) => choice(workspaceId, k));
  const open = choices
    .filter((c) => c.kind !== TECH && !c.sessionId)
    .map((c) => c.kind);
  return {
    workspaceId,
    workspace: workspace.name,
    enabled: experimentOn("leads"),
    hasLeads: hasLeads(workspaceId),
    hasOrchestrator: !!getOrchestrator(workspaceId),
    choices,
    custom,
    candidates: candidates(workspaceId, open),
  };
}
