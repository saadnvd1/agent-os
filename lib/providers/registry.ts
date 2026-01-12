/**
 * Provider Registry
 *
 * Centralized configuration for all AI coding agent providers.
 */

export const PROVIDER_IDS = [
  'claude',
  'codex',
  'opencode',
  'gemini',
  'aider',
  'cursor',
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
  cli: string;                      // Command name (e.g., 'claude', 'codex')
  configDir: string;                // Config directory path

  // Auto-approve configuration
  autoApproveFlag?: string;         // Flag to skip permission prompts

  // Session management
  supportsResume: boolean;
  supportsFork: boolean;
  resumeFlag?: string;              // Flag for resuming sessions

  // Model configuration
  modelFlag?: string;               // Flag for specifying model

  // Default arguments
  defaultArgs?: string[];           // Always passed to CLI
}

/**
 * Provider Registry
 * All supported agent providers with their configurations
 */
export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: "Anthropic's official CLI",
    cli: 'claude',
    configDir: '~/.claude',
    autoApproveFlag: '--dangerously-skip-permissions',
    supportsResume: true,
    supportsFork: true,
    resumeFlag: '--resume',
    modelFlag: undefined, // Claude doesn't expose model flag
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI's CLI",
    cli: 'codex',
    configDir: '~/.codex',
    autoApproveFlag: '--approval-mode full-auto',
    supportsResume: false,
    supportsFork: false,
    modelFlag: '--model',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Multi-provider AI CLI',
    cli: 'opencode',
    configDir: '~/.opencode.json',
    autoApproveFlag: undefined, // OpenCode manages this via config
    supportsResume: false,
    supportsFork: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: "Google's AI CLI",
    cli: 'gemini',
    configDir: '~/.gemini',
    autoApproveFlag: '--yolomode',
    supportsResume: false,
    supportsFork: false,
    modelFlag: '-m',
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'AI pair programming',
    cli: 'aider',
    configDir: '~/.aider',
    autoApproveFlag: '--yes',
    supportsResume: false,
    supportsFork: false,
    modelFlag: '--model',
  },
  {
    id: 'cursor',
    name: 'Cursor CLI',
    description: "Cursor's AI agent",
    cli: 'cursor-agent',
    configDir: '~/.cursor',
    autoApproveFlag: '-p', // Cursor uses -p for auto-approve
    supportsResume: false,
    supportsFork: false,
    modelFlag: '--model',
    defaultArgs: ['chat'], // cursor-agent requires 'chat' subcommand
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
