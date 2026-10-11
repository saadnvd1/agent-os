/**
 * What an agent is launched with to run on its routed model: the model
 * name for its CLI, and the provider's endpoint and key in its environment.
 */

import type { Session } from "../db";
import {
  defaultRoute,
  providerEnv,
  providerFor,
  providerShellEnv,
  resolveRole,
  setSessionModel,
  type ModelOverride,
} from "./resolve";
import { ANTHROPIC, type ModelRole } from "./roles";
import { redact, type SecretCommand } from "./secrets";

const why = (error: unknown) =>
  redact(error instanceof Error ? error.message : String(error));

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

// A one-shot run (a review, a scope check, a title) on its role's model,
// or on the role's default when its provider is off or its key can't be
// read: a title or a review still happens.
export async function routedRun(
  role: ModelRole,
  opts: { workspaceId?: string | null; override?: ModelOverride | null } = {},
  exec?: SecretCommand
): Promise<RoutedRun> {
  try {
    const routed = resolveRole(role, opts);
    return {
      model: routed.model,
      provider: routed.provider.id,
      env: await providerEnv(routed.provider, routed.model, exec),
    };
  } catch (error) {
    const routed = defaultRoute(role);
    console.warn(`[models] ${role}: ${why(error)}; on ${routed.ref} instead`);
    return { model: routed.model, provider: ANTHROPIC, env: {} };
  }
}

// An orchestrator runs on its role's model, as its workspace and Settings
// say now: each worker start picks up a change. When that provider is off
// or its key can't be read, it starts on the default rather than not at all.
export async function routeOrchestrator(
  session: Session,
  exec?: SecretCommand
): Promise<Session> {
  if (session.role !== "orchestrator") return session;
  let routed;
  try {
    routed = resolveRole("orchestrator", { workspaceId: session.workspace_id });
    await providerEnv(routed.provider, routed.model, exec);
  } catch (error) {
    routed = defaultRoute("orchestrator");
    console.warn(
      `[models] orchestrator: ${why(error)}; on ${routed.ref} instead`
    );
  }
  setSessionModel(session.id, routed);
  return {
    ...session,
    model: routed.model,
    model_provider:
      routed.provider.id === ANTHROPIC ? null : routed.provider.id,
  };
}
