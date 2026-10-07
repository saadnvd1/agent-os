/**
 * Provider Registry
 *
 * Centralized configuration for all AI coding agent providers.
 */

export const PROVIDER_IDS = [
  "claude",
  "codex",
  "opencode",
  "kilocode",
  "gemini",
  "aider",
  "cursor",
  "amp",
  "pi",
  "omp",
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

  // Session management: the arguments that continue a conversation, or
  // start a new one from it. They go first: some CLIs take a subcommand.
  supportsResume: boolean;
  supportsFork: boolean;
  resumeArgs?: (id: string) => string[];
  forkArgs?: (id: string) => string[];

  // Model configuration
  modelFlag?: string; // Flag for specifying model

  // Initial prompt configuration
  // undefined = no support, '' = positional arg, string = flag (e.g., '--prompt')
  initialPromptFlag?: string;

  // Default arguments
  defaultArgs?: string[]; // Always passed to CLI
}

// The model value that means "whatever the agent itself defaults to".
export const AGENT_DEFAULT_MODEL = "default";

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
    resumeArgs: (id) => ["--resume", id],
    forkArgs: (id) => ["--resume", id, "--fork-session"],
    modelFlag: undefined, // Claude doesn't expose model flag
    initialPromptFlag: "", // Positional argument
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's CLI",
    cli: "codex",
    configDir: "~/.codex",
    autoApproveFlag: "--dangerously-bypass-approvals-and-sandbox",
    supportsResume: true,
    supportsFork: true,
    resumeArgs: (id) => ["resume", id],
    forkArgs: (id) => ["fork", id],
    modelFlag: "--model",
    initialPromptFlag: "", // Positional argument
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Multi-provider AI CLI",
    cli: "opencode",
    configDir: "~/.config/opencode",
    autoApproveFlag: "--auto",
    supportsResume: true,
    supportsFork: true,
    resumeArgs: (id) => ["--session", id],
    forkArgs: (id) => ["--session", id, "--fork"],
    modelFlag: "--model",
    initialPromptFlag: "--prompt",
  },
  {
    id: "kilocode",
    name: "Kilo Code",
    description: "Kilo's AI coding CLI",
    cli: "kilo",
    configDir: "~/.config/kilo/kilo.json",
    autoApproveFlag: undefined, // Kilo manages this via config
    supportsResume: true,
    supportsFork: true,
    resumeArgs: (id) => ["--session", id],
    forkArgs: (id) => ["--session", id, "--fork"],
    initialPromptFlag: "--prompt",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's AI CLI",
    cli: "gemini",
    configDir: "~/.gemini",
    autoApproveFlag: "--yolo",
    supportsResume: false,
    supportsFork: false,
    modelFlag: "-m",
    // -p answers once and exits; -i answers and stays interactive.
    initialPromptFlag: "-i",
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
    autoApproveFlag: "--force",
    supportsResume: true,
    supportsFork: false,
    resumeArgs: (id) => ["--resume", id],
    modelFlag: "--model",
    initialPromptFlag: "", // Positional argument
  },
  {
    id: "amp",
    name: "Amp",
    description: "Multi-model coding agent",
    cli: "amp",
    configDir: "~/.config/amp",
    autoApproveFlag: "--dangerously-allow-all",
    supportsResume: true,
    supportsFork: false,
    resumeArgs: (id) => ["threads", "continue", id],
    initialPromptFlag: "", // Positional argument
  },
  {
    id: "pi",
    name: "Pi",
    description: "Extensible coding harness",
    cli: "pi",
    configDir: "~/.pi/agent",
    // Pi never asks before a tool runs.
    supportsResume: true,
    supportsFork: true,
    resumeArgs: (id) => ["--session", id],
    forkArgs: (id) => ["--fork", id],
    modelFlag: "--model",
    initialPromptFlag: "", // Positional argument
  },
  {
    id: "omp",
    name: "Oh My Pi",
    description: "Enhanced Pi coding harness",
    cli: "omp",
    configDir: "~/.omp",
    autoApproveFlag: undefined,
    supportsResume: false,
    supportsFork: false,
    modelFlag: "--model",
    initialPromptFlag: "", // Positional argument
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
