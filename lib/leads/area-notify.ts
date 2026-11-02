// Work started in another lead's area, or changed there by the chief: the
// server, not the one acting, tells that lead in its own chat and records
// it as mail, so the lead can push back. Every start path records its
// starter (recordStart), so a start can't slip past this by the tool it
// came through; the chief's other acts are told from its tool calls.

import { db } from "../db";
import { randomUUID } from "crypto";
import type { Project, Session } from "../db/types";
import { getProject } from "../projects";
import { shortId } from "../orchestrator/describe";
import { untrusted } from "../orchestrator/untrusted";
import { leadsOwning } from "./charters";
import { deliverToLead } from "./deliver";
import { getLead, leadTitle } from "./home";
import { addLeadMessage, markOneRead } from "./messages";
import { TECH, type LeadKind } from "./types";

export const AREA_THREAD = "Started in your area";

type Started = Pick<Session, "id" | "name" | "project_id" | "started_by_lead">;

// The leads whose area holds the project, other than the one that acted.
// A project no lead has claimed is Tech's, which runs the workspace's code.
export function areaOwners(
  workspaceId: string,
  projectId: string,
  starter: LeadKind
): LeadKind[] {
  const p = getProject(projectId);
  if (!p) return [];
  const boards = [p.lh_board_id, p.lh_board_name].filter(
    (b): b is string => !!b
  );
  const owners = [
    ...new Set([
      ...leadsOwning(workspaceId, "project", p.id),
      ...boards.flatMap((b) => leadsOwning(workspaceId, "board", b)),
    ]),
  ];
  return (owners.length ? owners : [TECH]).filter((k) => k !== starter);
}

// Tells each lead whose area the project is, in its own chat, and records
// it as mail from the one that acted, so the lead can push back.
async function tellOwners(
  workspaceId: string,
  starter: LeadKind,
  project: Project,
  text: string,
  // What the lead's agent reads; text that came from elsewhere is fenced.
  told: string,
  idPrefix: string
): Promise<number> {
  const starterTitle = leadTitle(workspaceId, starter);
  let n = 0;
  for (const owner of areaOwners(workspaceId, project.id, starter)) {
    const lead = getLead(workspaceId, owner);
    if (!lead) continue;
    const m = addLeadMessage({
      workspaceId,
      fromKind: starter,
      toKind: owner,
      thread: AREA_THREAD,
      text,
    });
    await deliverToLead(
      lead.id,
      `[AgentOS: the ${starterTitle} ${told} in ${project.name}, which is in your area as the ${leadTitle(workspaceId, owner)}. AgentOS tells you this whenever another lead or the chief acts in your area. If it clashes with your work or direction, say so with message_lead (to "${starter}"), or raise it with the owner.]`,
      {
        id: `${idPrefix}-${m.id}`,
        origin: {
          kind: "event",
          label: "AgentOS",
          body: text,
          mail: { id: m.id, thread: AREA_THREAD, from: starter, to: owner },
        },
      }
    );
    markOneRead(m.id);
    n++;
  }
  return n;
}

export async function notifyAreaStart(
  workspaceId: string,
  sessionId: string
): Promise<number> {
  const s = db
    .prepare(
      `SELECT id, name, project_id, started_by_lead FROM session_rows WHERE id = ?`
    )
    .get(sessionId) as Started | undefined;
  if (!s?.project_id || !s.started_by_lead) return 0;
  const project = getProject(s.project_id);
  if (!project) return 0;
  return tellOwners(
    workspaceId,
    s.started_by_lead,
    project,
    `Started "${s.name}" (session ${shortId(s.id)}) in ${project.name}, which is in your area.`,
    `started ${untrusted("session name", s.name)} (session ${shortId(s.id)})`,
    "lead-area"
  );
}

// The chief changed work that already exists (stopped, dropped, messaged
// it): the same notice as a start. `what` names the target, so it's fenced.
export async function notifyAreaAction(
  workspaceId: string,
  actor: LeadKind,
  project: Project,
  what: string
): Promise<number> {
  return tellOwners(
    workspaceId,
    actor,
    project,
    `${what[0].toUpperCase()}${what.slice(1)} in ${project.name}, which is in your area.`,
    untrusted("what it did", what),
    `lead-act-${randomUUID().slice(0, 8)}`
  );
}
