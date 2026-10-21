/**
 * "@reviewer", "@developer", "@analyst", "@supervisor": the live session in
 * that agent role. The caller's crew first, then its project; a supervisor
 * nobody started is the workspace's orchestrator. More than one match
 * refuses and lists them, like any other name.
 */

import type { Session } from "../db";

type RoleSession = Pick<
  Session,
  | "id"
  | "name"
  | "role"
  | "agent_role"
  | "crew_id"
  | "project_id"
  | "workspace_id"
>;
import {
  AGENT_ROLES,
  isAgentRole,
  type AgentRole,
} from "../models/agent-roles";

export type RoleAlias<T extends RoleSession = Session> =
  { ok: true; session: T } | { ok: false; none: boolean; error: string };

export const roleAliasOf = (ref: string): AgentRole | null => {
  const m = /^@([a-z]+)$/i.exec(ref.trim());
  const role = m?.[1].toLowerCase();
  return isAgentRole(role) ? role : null;
};

const label = (s: RoleSession) => `${s.name} (id ${s.id.slice(0, 8)})`;

export function resolveRoleAlias<T extends RoleSession>(
  role: AgentRole,
  sessions: T[],
  caller: RoleSession | undefined
): RoleAlias<T> {
  const others = sessions.filter((s) => s.id !== caller?.id);
  const inRole = others.filter((s) => s.agent_role === role);
  const scopes = [
    caller?.crew_id ? inRole.filter((s) => s.crew_id === caller.crew_id) : [],
    caller?.project_id && caller.project_id !== "uncategorized"
      ? inRole.filter((s) => s.project_id === caller.project_id)
      : [],
  ];
  for (const found of scopes) {
    if (found.length === 1) return { ok: true, session: found[0] };
    if (found.length > 1)
      return {
        ok: false,
        none: false,
        error: `"@${role}" matches ${found.length} sessions: ${found.map(label).join(", ")}. Use the name or the id`,
      };
  }
  if (role === "supervisor" && caller?.workspace_id) {
    const orchestrator = others.find(
      (s) => s.role === "orchestrator" && s.workspace_id === caller.workspace_id
    );
    if (orchestrator) return { ok: true, session: orchestrator };
  }
  return {
    ok: false,
    none: true,
    error: `No ${role} is running in your crew or project. Roles: ${AGENT_ROLES.map((r) => `@${r}`).join(", ")}. Run: aos peers`,
  };
}
