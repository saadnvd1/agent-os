/**
 * Which model a piece of work runs on, and what its agent needs to reach
 * it. The most specific setting wins: the task's own override, then its
 * workspace's, then Settings, then AGENTOS_REVIEW_MODEL or
 * AGENTOS_TITLE_MODEL, then the default (lib/models/roles).
 */

import { SUBAGENTS_ENV } from "./subagent-env";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import {
  effectiveModels,
  roleMapSchema,
  savedModelSettings,
  workspaceModels,
  type EffectiveModels,
  type RoleMap,
} from "./config";
import { ANTHROPIC_PROVIDER, type ModelProvider } from "./providers";
import {
  ANTHROPIC,
  DEFAULT_ROLE_MODELS,
  GATE_ROLES,
  formatModelRef,
  isModelRole,
  parseModelRef,
  sessionRole,
  type ModelRole,
} from "./roles";
import {
  resolveSecret,
  secretShellExpansion,
  type SecretCommand,
} from "./secrets";

export type RoleSource = "task" | "workspace" | "settings" | "env" | "default";

// The server's own environment can still stand in for a role's default:
// what AgentOS read before model routing existed.
const ENV_ROLE_MODELS: Partial<Record<ModelRole, string>> = {
  review: "AGENTOS_REVIEW_MODEL",
  scope: "AGENTOS_REVIEW_MODEL",
  helper: "AGENTOS_TITLE_MODEL",
};

const envModel = (role: ModelRole): string | undefined => {
  const name = ENV_ROLE_MODELS[role];
  return (name && process.env[name]?.trim()) || undefined;
};

export interface RoutedModel {
  role: ModelRole;
  ref: string;
  provider: ModelProvider;
  model: string;
  source: RoleSource;
}

// A task's override: one model for all its roles, or a model per role.
export type ModelOverride = string | RoleMap;

export function parseOverride(value: unknown): ModelOverride | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const ref = value.trim();
    providerFor(parseModelRef(ref).provider);
    return ref.includes("/") ? ref : formatModelRef(parseModelRef(ref));
  }
  const got = roleMapSchema.safeParse(value);
  const gate = got.success && GATE_ROLES.find((r) => got.data[r]);
  if (gate)
    throw new Error(
      `model: a task can't pick its own ${gate} model; set it in Settings or the workspace`
    );
  if (!got.success)
    throw new Error(
      `model: give "provider/model", or a map of role to "provider/model"`
    );
  for (const ref of Object.values(got.data))
    if (ref) providerFor(parseModelRef(ref).provider);
  return Object.keys(got.data).length ? got.data : null;
}

const overrideFor = (o: ModelOverride | null | undefined, role: ModelRole) =>
  GATE_ROLES.includes(role) ? undefined : typeof o === "string" ? o : o?.[role];

// The provider by id, or throws why it can't be used.
export function providerFor(
  id: string,
  models: EffectiveModels = effectiveModels()
): ModelProvider {
  if (id === ANTHROPIC) return ANTHROPIC_PROVIDER;
  const p = models.providers.find((x) => x.id === id);
  if (!p) throw new Error(`No model provider "${id}" (Settings > Models)`);
  if (!p.enabled) throw new Error(`The ${p.label} provider is turned off`);
  if (!p.baseUrl || !p.auth)
    throw new Error(`The ${p.label} provider needs a base URL and a key`);
  if (p.api !== "anthropic")
    throw new Error(
      `${p.label} speaks the OpenAI API; Claude Code needs an Anthropic-compatible endpoint`
    );
  return p;
}

export function resolveRole(
  role: ModelRole,
  opts: { workspaceId?: string | null; override?: ModelOverride | null } = {},
  models: EffectiveModels = effectiveModels()
): RoutedModel {
  const task = overrideFor(opts.override, role);
  const ws = opts.workspaceId
    ? workspaceModels(opts.workspaceId).roles?.[role]
    : undefined;
  const saved = models.roles[role];
  // The variable stands in only where Settings names nothing for the role.
  const env =
    saved === DEFAULT_ROLE_MODELS[role] && !savedModelSettings().roles?.[role]
      ? envModel(role)
      : undefined;
  const [ref, source]: [string, RoleSource] = task
    ? [task, "task"]
    : ws
      ? [ws, "workspace"]
      : saved !== DEFAULT_ROLE_MODELS[role]
        ? [saved, "settings"]
        : env
          ? [env, "env"]
          : [saved, "default"];
  const parsed = parseModelRef(ref);
  return {
    role,
    ref: formatModelRef(parsed),
    provider: providerFor(parsed.provider, models),
    model: parsed.model,
    source,
  };
}

// The role's built-in model on the Claude login: what work falls back to
// when the provider it's routed to can't be used.
export function defaultRoute(role: ModelRole): RoutedModel {
  const parsed = parseModelRef(DEFAULT_ROLE_MODELS[role]);
  return {
    role,
    ref: formatModelRef(parsed),
    provider: ANTHROPIC_PROVIDER,
    model: parsed.model,
    source: "default",
  };
}

export function resolveRoleOrDefault(
  role: ModelRole,
  opts: { workspaceId?: string | null } = {}
): RoutedModel {
  try {
    return resolveRole(role, opts);
  } catch {
    return defaultRoute(role);
  }
}

// A session's workspace: an orchestrator's own, or its project's.
export function sessionWorkspace(
  session: Pick<Session, "workspace_id" | "project_id">
): string | null {
  if (session.workspace_id) return session.workspace_id;
  return session.project_id
    ? (getProject(session.project_id)?.workspace_id ?? null)
    : null;
}

export function taskOverride(
  session: Pick<Session, "model_overrides">
): ModelOverride | null {
  if (!session.model_overrides) return null;
  try {
    return parseOverride(JSON.parse(session.model_overrides));
  } catch {
    return null;
  }
}

// What the agent's environment needs beyond the model name, with the key
// fetched now. Nothing for Anthropic: the Claude login is the default.
export async function providerEnv(
  provider: ModelProvider,
  model: string,
  exec?: SecretCommand
): Promise<Record<string, string>> {
  if (provider.id === ANTHROPIC) return {};
  const key = await resolveSecret(provider.auth!, exec);
  return { ...routingEnv(provider, model), [authVar(provider)]: key };
}

// The same for a terminal launch: the plain settings, and shell text that
// sets the key from its reference inside the agent's shell.
export function providerShellEnv(
  provider: ModelProvider,
  model: string
): { env: Record<string, string>; exportKey: string } {
  if (provider.id === ANTHROPIC) return { env: {}, exportKey: "" };
  return {
    env: routingEnv(provider, model),
    exportKey: `export ${authVar(provider)}=${secretShellExpansion(provider.auth!)};`,
  };
}

const authVar = (p: ModelProvider) =>
  p.authHeader === "x-api-key" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN";

// The endpoint, Claude Code's tiers mapped to its models (so subagents and
// background calls asking for "haiku" stay on it), and the other key
// variable emptied so a key in AgentOS's own environment isn't sent there.
function routingEnv(p: ModelProvider, model: string): Record<string, string> {
  const other =
    authVar(p) === "ANTHROPIC_API_KEY"
      ? "ANTHROPIC_AUTH_TOKEN"
      : "ANTHROPIC_API_KEY";
  return {
    ...p.env,
    ...(p.contextWindow
      ? { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(p.contextWindow) }
      : {}),
    ANTHROPIC_BASE_URL: p.baseUrl!,
    [other]: "",
    ANTHROPIC_DEFAULT_OPUS_MODEL: p.tiers?.opus ?? model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: p.tiers?.sonnet ?? model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: p.tiers?.haiku ?? model,
    CLAUDE_CODE_SUBAGENT_MODEL: p.tiers?.sonnet ?? model,
    // Per-type subagent routing is for Claude's own models.
    [SUBAGENTS_ENV]: "",
  };
}

// Records what a session runs on: the model its CLI is given, and its
// provider (NULL for Anthropic).
export function setSessionModel(sessionId: string, routed: RoutedModel): void {
  db.prepare(
    `UPDATE sessions SET model = ?, model_provider = ? WHERE id = ?`
  ).run(
    routed.model,
    routed.provider.id === ANTHROPIC ? null : routed.provider.id,
    sessionId
  );
}

export const sessionModelRef = (
  s: Pick<Session, "model" | "model_provider">
): string => `${s.model_provider ?? ANTHROPIC}/${s.model}`;

export { isModelRole, sessionRole };
