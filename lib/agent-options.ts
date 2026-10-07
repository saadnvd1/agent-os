import type { AgentType } from "./providers";

// The agent CLIs a session can run, as offered in pickers.
export const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "kilocode", label: "Kilo Code" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "aider", label: "Aider" },
  { value: "cursor", label: "Cursor CLI" },
  { value: "amp", label: "Amp" },
  { value: "pi", label: "Pi" },
  { value: "omp", label: "Oh My Pi" },
];

export const agentLabel = (agent: AgentType) =>
  AGENT_OPTIONS.find((o) => o.value === agent)?.label ?? agent;
