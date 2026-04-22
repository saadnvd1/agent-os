import type { AgentType } from "./providers";

export interface ModelOption {
  value: string;
  label: string;
}

const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

const CODEX_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
  { value: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
];

const GEMINI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  {
    value: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash-Lite Preview",
  },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
];

const MODEL_OPTIONS_BY_AGENT: Partial<Record<AgentType, ModelOption[]>> = {
  claude: CLAUDE_MODEL_OPTIONS,
  codex: CODEX_MODEL_OPTIONS,
  gemini: GEMINI_MODEL_OPTIONS,
};

const DEFAULT_MODEL_BY_AGENT: Partial<Record<AgentType, string>> = {
  claude: "sonnet",
  codex: "gpt-5.4",
  gemini: "gemini-2.5-pro",
};

export function getModelOptions(agentType: AgentType): ModelOption[] {
  return MODEL_OPTIONS_BY_AGENT[agentType] ?? CLAUDE_MODEL_OPTIONS;
}

export function getDefaultModelForAgent(agentType: AgentType): string {
  return (
    DEFAULT_MODEL_BY_AGENT[agentType] ??
    getModelOptions(agentType)[0]?.value ??
    "sonnet"
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
