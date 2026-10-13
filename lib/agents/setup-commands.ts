/**
 * The official commands the welcome runs in its terminal to install an agent
 * CLI or sign it in. Typed into the user's own shell, never run by the
 * server, so they are the same lines the install script (scripts/lib/ai-clis.sh)
 * uses.
 */

import type { ProviderId } from "../providers/registry";

export interface SetupCommands {
  install?: string;
  signIn?: string;
  docs?: string;
}

export const SETUP_COMMANDS: Partial<Record<ProviderId, SetupCommands>> = {
  claude: {
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    signIn: "claude auth login",
  },
  codex: {
    install: "npm install -g @openai/codex",
    signIn: "codex login",
  },
  gemini: {
    install: "npm install -g @google/gemini-cli",
    signIn: "gemini",
  },
  kilocode: { install: "npm install -g @kilocode/cli", signIn: "kilo" },
  cursor: { signIn: "cursor-agent login", docs: "https://cursor.com/cli" },
  amp: { signIn: "amp login", docs: "https://ampcode.com" },
  pi: { signIn: "pi" },
  copilot: {
    install: "npm install -g @github/copilot",
    signIn: "copilot login",
  },
  kiro: {
    install: "curl -fsSL https://cli.kiro.dev/install | bash",
    signIn: "kiro-cli login --use-device-flow",
    docs: "https://kiro.dev/docs/cli/",
  },
  amazonq: {
    signIn: "q login --use-device-flow",
    docs: "https://kiro.dev/docs/cli/",
  },
  // No installer line we can vouch for from here; its own site has it.
  opencode: { docs: "https://opencode.ai/docs" },
};

// The ones the welcome shows up front; the rest wait behind "Show all".
export const FEATURED_AGENTS: ProviderId[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
];

export type AgentState = "missing" | "needs-login" | "ready" | "installed";

export function agentState(p: {
  installed: boolean;
  auth: "ready" | "needs-login" | "unknown";
}): AgentState {
  if (!p.installed) return "missing";
  if (p.auth === "needs-login") return "needs-login";
  return p.auth === "ready" ? "ready" : "installed";
}
