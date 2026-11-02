// Work started in another lead's area: the server, not the starter, tells
// that lead in its own chat and records it as mail from the starter, so the
// lead can push back. Every start path records its starter (recordStart),
// so a start can't slip past this by the tool it came through.

import { db } from "../db";
import type { Session } from "../db/types";
import { getProject } from "../projects";
import { shortId } from "../orchestrator/describe";
import { untrusted } from "../orchestrator/untrusted";
import { leadsOwning } from "./charters";
import { deliverToLead } from "./deliver";
import { getLead, leadTitle } from "./home";
import { addLeadMessage, markOneRead } from "./messages";
import type { LeadKind } from "./types";

export const AREA_THREAD = "Started in your area";

type Started = Pick<Session, "id" | "name" | "project_id" | "started_by_lead">;

// The leads whose area holds the project, other than the one that started it.
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
  return [
    ...new Set([
      ...leadsOwning(workspaceId, "project", p.id),
      ...boards.flatMap((b) => leadsOwning(workspaceId, "board", b)),
    ]),
  ].filter((k) => k !== starter);
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
  const starter = s.started_by_lead;
  const project = getProject(s.project_id);
  if (!project) return 0;
  const starterTitle = leadTitle(workspaceId, starter);
  let told = 0;
  for (const owner of areaOwners(workspaceId, project.id, starter)) {
    const lead = getLead(workspaceId, owner);
    if (!lead) continue;
    const text = `Started "${s.name}" (session ${shortId(s.id)}) in ${project.name}, which is in your area.`;
    const m = addLeadMessage({
      workspaceId,
      fromKind: starter,
      toKind: owner,
      thread: AREA_THREAD,
      text,
    });
    await deliverToLead(
      lead.id,
      `[AgentOS: the ${starterTitle} started ${untrusted("session name", s.name)} (session ${shortId(s.id)}) in ${project.name}, which is in your area as the ${leadTitle(workspaceId, owner)}. AgentOS tells you this whenever another lead or the chief starts work in your area. If it clashes with your work or direction, say so with message_lead (to "${starter}"), or raise it with the owner.]`,
      {
        id: `lead-area-${m.id}`,
        origin: {
          kind: "event",
          label: "AgentOS",
          body: text,
          mail: { id: m.id, thread: AREA_THREAD, from: starter, to: owner },
        },
      }
    );
    markOneRead(m.id);
    told++;
  }
  return told;
}
