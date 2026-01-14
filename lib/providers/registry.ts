/**
 * Provider Registry
 *
 * Centralized configuration for all AI coding agent providers.
 */

export const PROVIDER_IDS = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "aider",
  "cursor",
  "shell",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * Provider Definition
 * Declarative configuration for each agent provider
 */
export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;

  // CLI configuration
  cli: string; // Command name (e.g., 'claude', 'codex')
  configDir: string; // Config directory path

  // Auto-approve configuration
  autoApproveFlag?: string; // Flag to skip permission prompts

  // Session management
  supportsResume: boolean;
  supportsFork: boolean;
  resumeFlag?: string; // Flag for resuming sessions

  // Model configuration
  modelFlag?: string; // Flag for specifying model

  // Default arguments
  defaultArgs?: string[]; // Always passed to CLI
}

/**
 * Provider Registry
 * All supported agent providers with their configurations
 */
export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic's official CLI",
    cli: "claude",
    configDir: "~/.claude",
    autoApproveFlag: "--dangerously-skip-permissions",
    supportsResume: true,
    supportsFork: true,
    resumeFlag: "--resume",
    modelFlag: undefined, // Claude doesn't expose model flag
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's CLI",
    cli: "codex",
    configDir: "~/.codex",
    autoApproveFlag: "--approval-mode full-auto",
    supportsResume: false,
    supportsFork: false,
    modelFlag: "--model",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Multi-provider AI CLI",
    cli: "opencode",
    configDir: "~/.opencode.json",
    autoApproveFlag: undefined, // OpenCode manages this via config
    supportsResume: false,
    supportsFork: false,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's AI CLI",
    cli: "gemini",
    configDir: "~/.gemini",
    autoApproveFlag: "--yolomode",
    supportsResume: false,
    supportsFork: false,
    modelFlag: "-m",
  },
  {
    id: "aider",
    name: "Aider",
    description: "AI pair programming",
    cli: "aider",
    configDir: "~/.aider",
    autoApproveFlag: "--yes",
    supportsResume: false,
    supportsFork: false,
    modelFlag: "--model",
  },
  {
    id: "cursor",
    name: "Cursor CLI",
    description: "Cursor's AI agent",
    cli: "cursor-agent",
    configDir: "~/.cursor",
    autoApproveFlag: undefined, // -p requires a prompt, not auto-approve
    supportsResume: false,
    supportsFork: false,
    modelFlag: "--model",
  },
  {
    id: "shell",
    name: "Terminal",
    description: "Plain shell terminal",
    cli: "", // No CLI command - just shell
    configDir: "",
    autoApproveFlag: undefined,
    supportsResume: false,
    supportsFork: false,
  },
];

/**
 * Provider Map
 * Efficient lookup by provider ID
 */
export const PROVIDER_MAP = new Map<ProviderId, ProviderDefinition>(
  PROVIDERS.map((provider) => [provider.id, provider])
);

/**
 * Get provider definition by ID
 */
export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  const provider = PROVIDER_MAP.get(id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

/**
 * Get all provider definitions
 */
export function getAllProviderDefinitions(): ProviderDefinition[] {
  return PROVIDERS;
}

/**
 * Check if a string is a valid provider ID
 */
export function isValidProviderId(value: string): value is ProviderId {
  return PROVIDER_MAP.has(value as ProviderId);
}

/**
 * Get regex pattern for matching AgentOS-managed tmux session names
 * Format: {provider}-{uuid}
 */
export function getManagedSessionPattern(): RegExp {
  const providerPattern = PROVIDER_IDS.join("|");
  return new RegExp(
    `^(${providerPattern})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    "i"
  );
}

/**
 * Get provider ID from a session name (e.g., "claude-abc123" -> "claude")
 */
export function getProviderIdFromSessionName(
  sessionName: string
): ProviderId | null {
  for (const id of PROVIDER_IDS) {
    if (sessionName.startsWith(`${id}-`)) {
      return id;
    }
  }
  return null;
}

/**
 * Extract the UUID from a session name (e.g., "claude-abc123" -> "abc123")
 */
export function getSessionIdFromName(sessionName: string): string {
  const providerPattern = PROVIDER_IDS.join("|");
  return sessionName.replace(new RegExp(`^(${providerPattern})-`, "i"), "");
}
