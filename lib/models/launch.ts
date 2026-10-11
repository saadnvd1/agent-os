/**
 * What an agent is launched with to run on its routed model: the model
 * name for its CLI, and the provider's endpoint and key in its environment.
 */

import type { Session } from "../db";
import {
  providerEnv,
  providerFor,
  providerShellEnv,
  resolveRole,
  setSessionModel,
  type ModelOverride,
} from "./resolve";
import { ANTHROPIC, type ModelRole } from "./roles";
import type { SecretCommand } from "./secrets";

// A chat session's provider environment, or null on Anthropic.
export async function sessionProviderEnv(
  session: Pick<Session, "model" | "model_provider">,
  exec?: SecretCommand
): Promise<Record<string, string> | null> {
  if (!session.model_provider) return null;
  return providerEnv(providerFor(session.model_provider), session.model, exec);
}

// A terminal session's: plain settings for its tmux environment, and shell
// text that sets the key from its reference inside the pane.
export function sessionShellEnv(
  session: Pick<Session, "model" | "model_provider">
): { env: Record<string, string>; exportKey: string } {
  if (!session.model_provider) return { env: {}, exportKey: "" };
  return providerShellEnv(providerFor(session.model_provider), session.model);
}

export interface RoutedRun {
  model: string;
  provider: string;
  env: Record<string, string>;
}

// A one-shot run (a review, a scope check, a title) on its role's model.
export async function routedRun(
  role: ModelRole,
  opts: { workspaceId?: string | null; override?: ModelOverride | null } = {},
  exec?: SecretCommand
): Promise<RoutedRun> {
  const routed = resolveRole(role, opts);
  return {
    model: routed.model,
    provider: routed.provider.id,
    env: await providerEnv(routed.provider, routed.model, exec),
  };
}

// An orchestrator runs on its role's model, as its workspace and Settings
// say now: each worker start picks up a change.
export function routeOrchestrator(session: Session): Session {
  if (session.role !== "orchestrator") return session;
  const routed = resolveRole("orchestrator", {
    workspaceId: session.workspace_id,
  });
  setSessionModel(session.id, routed);
  return {
    ...session,
    model: routed.model,
    model_provider:
      routed.provider.id === ANTHROPIC ? null : routed.provider.id,
  };
}
