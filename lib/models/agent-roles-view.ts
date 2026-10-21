/**
 * What the Agent roles screen and the native app show: each role, the model
 * saved at a scope, the model in force there and where it came from, and
 * what the server knows of that model (local or cloud, answering or not).
 * Saving checks what a role may run on.
 */

import {
  AGENT_ROLES,
  AGENT_ROLE_DEFS,
  INTERNAL_MODEL_ROLES,
  type AgentRole,
} from "./agent-roles";
import { choiceFor, type ModelChoice } from "./catalog";
import {
  effectiveModels,
  projectModels,
  savedModelSettings,
  setModelSettings,
  setProjectModels,
  setWorkspaceModels,
  workspaceModels,
  type RoleMap,
} from "./config";
import { PI } from "./providers";
import { resolveRole, type RoleSource } from "./resolve";
import {
  DEFAULT_ROLE_MODELS,
  GATE_ROLES,
  MODEL_ROLES,
  ROLE_LABELS,
  parseModelRef,
  type ModelRole,
} from "./roles";

export type RoleScope = "settings" | "workspace" | "project";
export interface ScopeRef {
  scope: RoleScope;
  id?: string | null;
}

export interface RoleView {
  modelRole: ModelRole;
  label: string;
  hint: string;
  // Saved at this scope, or null when it inherits.
  value: string | null;
  binding: { ref: string; source: RoleSource } | null;
  fallback: string | null;
  choice: ModelChoice | null;
  // Why the binding can't be used (a provider turned off).
  error?: string;
  default: string;
}

export interface AgentRoleView extends RoleView {
  id: AgentRole;
  purpose: string;
  brief: string;
  edits: boolean;
}

function savedAt({ scope, id }: ScopeRef): RoleMap {
  if (scope === "workspace" && id) return workspaceModels(id).roles ?? {};
  if (scope === "project" && id) return projectModels(id).roles ?? {};
  return savedModelSettings().roles ?? {};
}

function viewOf(modelRole: ModelRole, at: ScopeRef, ctx: ContextIds): RoleView {
  const effective = effectiveModels();
  let binding: RoleView["binding"] = null;
  let error: string | undefined;
  try {
    const r = resolveRole(modelRole, { ...ctx, allowPi: true }, effective);
    binding = { ref: r.ref, source: r.source };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return {
    modelRole,
    label: ROLE_LABELS[modelRole].label,
    hint: ROLE_LABELS[modelRole].hint,
    value: savedAt(at)[modelRole] ?? null,
    binding,
    fallback: savedModelSettings().fallbacks?.[modelRole] ?? null,
    choice: binding ? (choiceFor(binding.ref, effective) ?? null) : null,
    ...(error ? { error } : {}),
    default: DEFAULT_ROLE_MODELS[modelRole],
  };
}

interface ContextIds {
  workspaceId?: string | null;
  projectId?: string | null;
}

const contextOf = ({ scope, id }: ScopeRef): ContextIds =>
  scope === "workspace"
    ? { workspaceId: id }
    : scope === "project"
      ? { projectId: id }
      : {};

export function agentRolesView(at: ScopeRef, ctx?: ContextIds) {
  const ids = ctx ?? contextOf(at);
  return {
    roles: AGENT_ROLES.map((id): AgentRoleView => ({
      ...viewOf(AGENT_ROLE_DEFS[id].modelRole, at, ids),
      id,
      label: AGENT_ROLE_DEFS[id].label,
      hint: AGENT_ROLE_DEFS[id].purpose,
      purpose: AGENT_ROLE_DEFS[id].purpose,
      brief: AGENT_ROLE_DEFS[id].brief,
      edits: AGENT_ROLE_DEFS[id].edits,
    })),
    internal: INTERNAL_MODEL_ROLES(MODEL_ROLES).map((r) => viewOf(r, at, ids)),
  };
}

// The models a role can be bound to: a Pi model runs a role session only,
// never a task, a gate or the orchestrator.
const PI_ROLES: readonly ModelRole[] = ["implement", "analyze", "advise"];

function checkRoles(roles: RoleMap): void {
  for (const [role, ref] of Object.entries(roles) as [ModelRole, string][]) {
    if (parseModelRef(ref).provider !== PI) continue;
    if (!PI_ROLES.includes(role))
      throw new Error(
        `${ROLE_LABELS[role].label} can't run on a Pi model (${GATE_ROLES.includes(role) ? "a merge gate needs Claude Code" : "only the Developer, Analyst and Reviewer can"})`
      );
  }
}

export function saveAgentRoles(
  at: ScopeRef,
  roles: RoleMap,
  fallbacks?: RoleMap
): void {
  checkRoles(roles);
  if (fallbacks) {
    for (const ref of Object.values(fallbacks))
      if (ref && parseModelRef(ref).provider === PI)
        throw new Error("A fallback must be a cloud or Claude Code model");
  }
  if (at.scope === "settings") {
    const saved = savedModelSettings();
    setModelSettings({
      ...saved,
      roles,
      ...(fallbacks ? { fallbacks } : {}),
    });
    return;
  }
  if (!at.id) throw new Error(`${at.scope} needs an id`);
  if (at.scope === "workspace") setWorkspaceModels(at.id, { roles });
  else setProjectModels(at.id, { roles });
}
