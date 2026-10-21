/**
 * A crew: the sessions started in roles that work together. Its id is the
 * session that began it, so a crew needs no table of its own.
 */

import { db } from "../db";
import type { AgentRole } from "../models/agent-roles";

const crewOf = (id: string | null | undefined): string | null =>
  id
    ? ((
        db.prepare(`SELECT crew_id FROM session_rows WHERE id = ?`).get(id) as
          { crew_id: string | null } | undefined
      )?.crew_id ?? null)
    : null;

// Puts a session in a role and a crew: the one named, else its starter's (or
// its calling session's), else a new one it begins.
export function joinCrew(
  id: string,
  role: AgentRole,
  from: {
    crewId?: string | null;
    startedBy?: string | null;
    parent?: string | null;
  }
): string {
  const crew =
    from.crewId || crewOf(from.startedBy) || crewOf(from.parent) || id;
  db.prepare(
    `UPDATE sessions SET agent_role = ?, crew_id = ? WHERE id = ?`
  ).run(role, crew, id);
  return crew;
}

export interface CrewMember {
  id: string;
  name: string;
  agentRole: string | null;
  model: string | null;
  modelProvider: string | null;
  agentType: string;
  taskStatus: string | null;
}

export function crewMembers(crewId: string): CrewMember[] {
  return (
    db
      .prepare(
        `SELECT id, name, agent_role, model, model_provider, agent_type, task_status
           FROM session_rows WHERE crew_id = ? AND archived_at IS NULL
          ORDER BY created_at`
      )
      .all(crewId) as {
      id: string;
      name: string;
      agent_role: string | null;
      model: string | null;
      model_provider: string | null;
      agent_type: string;
      task_status: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    agentRole: r.agent_role,
    model: r.model,
    modelProvider: r.model_provider,
    agentType: r.agent_type,
    taskStatus: r.task_status,
  }));
}
