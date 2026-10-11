/**
 * The kinds of work AgentOS launches agents for, and the model each runs on
 * unless Settings, a workspace or the task says otherwise. A model is named
 * by a reference, "provider/model": the provider is one of lib/models/
 * providers, and the model is that provider's own id. Imported by the
 * browser too, so no Node modules here.
 */

export const MODEL_ROLES = [
  "plan",
  "implement",
  "orchestrator",
  "review",
  "scope",
  "interactive",
  "helper",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const ROLE_LABELS: Record<ModelRole, { label: string; hint: string }> = {
  plan: {
    label: "Task planning",
    hint: "A task's plan step, written to a file before any code changes",
  },
  implement: {
    label: "Task implementation",
    hint: "A task's agent, following the plan in its worktree",
  },
  orchestrator: { label: "Orchestrator", hint: "A workspace's orchestrator" },
  review: {
    label: "Gate review",
    hint: "The independent review a PR passes before it merges",
  },
  scope: { label: "Scope check", hint: "Whether a diff stays in its card" },
  interactive: {
    label: "Interactive sessions",
    hint: "Sessions you start and talk to yourself",
  },
  helper: {
    label: "Chat & summary helpers",
    hint: "Titles, summaries and digests",
  },
};

export const ANTHROPIC = "anthropic";
const OPUS = `${ANTHROPIC}/claude-opus-5-5`;
const SONNET = `${ANTHROPIC}/claude-sonnet-5-5`;
const HAIKU = `${ANTHROPIC}/claude-haiku-4-5-20251001`;

// Claude stays the default for every role: another provider is opt-in.
export const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  plan: OPUS,
  review: OPUS,
  implement: SONNET,
  orchestrator: OPUS,
  scope: SONNET,
  interactive: OPUS,
  helper: HAIKU,
};

// The roles that gate a task's merge: only Settings and its workspace pick
// their model, never the task (or the orchestrator that started it), so
// work can't choose its own reviewer.
export const GATE_ROLES: readonly ModelRole[] = ["review", "scope"];
export const TASK_ROLES = MODEL_ROLES.filter((r) => !GATE_ROLES.includes(r));

export const isModelRole = (v: unknown): v is ModelRole =>
  typeof v === "string" && (MODEL_ROLES as readonly string[]).includes(v);

export interface ModelRef {
  provider: string;
  model: string;
}

// "provider/model", split at the first slash (a model id may hold more).
// A bare model ("opus", "claude-sonnet-5-5") is Anthropic's.
export function parseModelRef(ref: string): ModelRef {
  const s = ref.trim();
  const at = s.indexOf("/");
  if (at <= 0) return { provider: ANTHROPIC, model: s };
  return { provider: s.slice(0, at), model: s.slice(at + 1) };
}

export const formatModelRef = (r: ModelRef) => `${r.provider}/${r.model}`;

export const REF_PATTERN = /^[a-z0-9][a-z0-9_-]*\/[\w.:@/-]+$/i;

// The role a session's next turn runs as.
export function sessionRole(session: {
  role?: string | null;
  task_status?: string | null;
  plan_phase?: string | null;
}): ModelRole {
  if (session.role === "orchestrator") return "orchestrator";
  if (!session.task_status) return "interactive";
  return session.plan_phase === "planning" ? "plan" : "implement";
}
