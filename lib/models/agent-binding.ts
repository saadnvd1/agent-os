/**
 * Starting a session in an agent role: which model its binding gives it,
 * whether that model's server answers, and what to run it on. A local model
 * that's down never turns into a cloud one by itself: only a fallback the
 * user set for the role, and only when the start asks for it.
 */

import { AGENT_ROLE_DEFS, type AgentRole } from "./agent-roles";
import { modelAvailability, choiceFor } from "./catalog";
import { savedModelSettings } from "./config";
import { PI } from "./providers";
import { resolveRole, type RoleSource, type RoutedModel } from "./resolve";

export interface RoleBinding {
  role: AgentRole;
  routed: RoutedModel;
  // The user's fallback for the role, if set.
  fallback?: string;
}

export function bindingFor(
  role: AgentRole,
  opts: {
    workspaceId?: string | null;
    projectId?: string | null;
    // The model picked for this one session.
    override?: string | null;
  } = {}
): RoleBinding {
  const modelRole = AGENT_ROLE_DEFS[role].modelRole;
  const routed = resolveRole(modelRole, { ...opts, allowPi: true });
  return {
    role,
    routed,
    fallback: savedModelSettings().fallbacks?.[modelRole],
  };
}

export class ModelUnavailableError extends Error {
  readonly code = "model_unavailable";
  constructor(
    readonly role: AgentRole,
    readonly ref: string,
    readonly detail: string,
    readonly fallback?: string
  ) {
    super(
      `${AGENT_ROLE_DEFS[role].label}'s model ${ref} isn't answering${detail ? ` (${detail})` : ""}`
    );
  }
}

export interface RoleStart {
  role: AgentRole;
  routed: RoutedModel;
  // "pi" runs the Pi agent on the model; "claude" runs Claude Code.
  agentType: "claude" | "pi";
  // What the agent CLI is given as its model.
  model: string;
  source: RoleSource | "fallback";
}

const startFrom = (
  role: AgentRole,
  routed: RoutedModel,
  source: RoleStart["source"]
): RoleStart =>
  routed.provider.id === PI
    ? {
        role,
        routed,
        agentType: "pi",
        model: routed.ref.slice(PI.length + 1),
        source,
      }
    : { role, routed, agentType: "claude", model: routed.model, source };

// The model a session started in `role` runs on, after checking its server.
export async function prepareRoleStart(
  role: AgentRole,
  opts: Parameters<typeof bindingFor>[1] & { useFallback?: boolean }
): Promise<RoleStart> {
  const binding = bindingFor(role, opts);
  const state = await modelAvailability(binding.routed.ref);
  if (state.state !== "down")
    return startFrom(role, binding.routed, binding.routed.source);
  if (opts.useFallback && binding.fallback) {
    const alt = bindingFor(role, { ...opts, override: binding.fallback });
    const altState = await modelAvailability(alt.routed.ref);
    if (altState.state !== "down")
      return startFrom(role, alt.routed, "fallback");
  }
  throw new ModelUnavailableError(
    role,
    binding.routed.ref,
    state.error ?? "",
    binding.fallback &&
      choiceFor(binding.fallback)?.availability.state !== "down"
      ? binding.fallback
      : undefined
  );
}
