import type { AgentType } from "./providers";

export interface ModelOption {
  value: string;
  label: string;
}

// Claude Code's family aliases always resolve to the newest model in each.
const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "fable", label: "Fable" },
  { value: "haiku", label: "Haiku" },
];

// Codex models that work with a ChatGPT sign-in, checked 2026-10-05.
// GPT-6 Astra and GPT-6.1 Sol are API-key only; GPT-5.4 retired 2026-08-31.
const CODEX_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-6-luna", label: "GPT-6 Luna" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];

// Current Gemini models as of 2026-10 (ai.google.dev/gemini-api/docs/models).
// The 2.5 family and the 3.x previews are superseded or shut down.
const GEMINI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
];

const MODEL_OPTIONS_BY_AGENT: Partial<Record<AgentType, ModelOption[]>> = {
  claude: CLAUDE_MODEL_OPTIONS,
  codex: CODEX_MODEL_OPTIONS,
  gemini: GEMINI_MODEL_OPTIONS,
};

const DEFAULT_MODEL_BY_AGENT: Partial<Record<AgentType, string>> = {
  claude: "opus",
  codex: "gpt-6-luna",
  gemini: "gemini-3.8-flash",
};

export function getModelOptions(agentType: AgentType): ModelOption[] {
  return MODEL_OPTIONS_BY_AGENT[agentType] ?? CLAUDE_MODEL_OPTIONS;
}

export function getDefaultModelForAgent(agentType: AgentType): string {
  return (
    DEFAULT_MODEL_BY_AGENT[agentType] ??
    getModelOptions(agentType)[0]?.value ??
    "opus"
  );
}

export function isSupportedModelForAgent(
  agentType: AgentType,
  model: string | null | undefined
): boolean {
  if (!model) {
    return false;
  }

  return getModelOptions(agentType).some((option) => option.value === model);
}

export function resolveModelForAgent(
  agentType: AgentType,
  model: string | null | undefined
): string {
  const normalizedModel =
    typeof model === "string" && model.trim() ? model.trim() : null;

  if (normalizedModel && isSupportedModelForAgent(agentType, normalizedModel)) {
    return normalizedModel;
  }

  return getDefaultModelForAgent(agentType);
}
