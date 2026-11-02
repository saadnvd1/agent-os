// Two leads don't start the same work. Before a lead's start_task or
// start_session, the claims check (lib/claims) looks for live work on the
// same files or branch; a strong overlap with work another lead (or the
// chief) started is refused, with who has it, instead of starting. Overlaps
// with its own work keep the orchestrator's behaviour (queue after it).

import { db } from "../db";
import { machineId } from "../claims/machine";
import { checkStart, overlapText } from "../claims/startCheck";
import { workspaceProject } from "../orchestrator/targets";
import { leadTitle } from "./home";
import type { LeadKind } from "./types";

const CHECKED = new Set(["start_task", "start_session"]);
const str = (v: unknown) => (typeof v === "string" ? v : "");

// The lead whose call started a local session, if one did.
function startedByLead(sessionId: string | null): LeadKind | null {
  if (!sessionId) return null;
  const row = db
    .prepare(`SELECT started_by_lead FROM sessions WHERE id = ?`)
    .get(sessionId) as { started_by_lead: string | null } | undefined;
  return row?.started_by_lead ?? null;
}

export async function leadStartRefusal(
  workspaceId: string,
  kind: LeadKind,
  tool: string,
  args: unknown
): Promise<string | null> {
  if (!CHECKED.has(tool)) return null;
  const a = (args ?? {}) as Record<string, unknown>;
  let projectId: string;
  try {
    projectId = workspaceProject(workspaceId, str(a.project)).id;
  } catch {
    // The tool says what's wrong with its project itself.
    return null;
  }
  const { overlaps } = await checkStart({
    projectId,
    name: str(a.name) || undefined,
    prompt: str(a.prompt),
  });
  for (const o of overlaps) {
    if (o.strength !== "strong" || o.b.origin !== machineId()) continue;
    const owner = startedByLead(o.b.sessionId);
    if (!owner || owner === kind) continue;
    const title = leadTitle(workspaceId, owner);
    return `Not started: the ${title} already has ${overlapText(o)}. Two leads don't start the same work; write to the ${title} with message_lead (to "${owner}") instead.`;
  }
  return null;
}
