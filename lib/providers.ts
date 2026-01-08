/**
 * Agent Provider Abstraction
 *
 * Defines interfaces and implementations for different AI coding CLI tools
 * (Claude Code, Codex, OpenCode, etc.)
 */

export type AgentType = "claude" | "codex" | "opencode" | "gemini";

export interface AgentProvider {
  // Metadata
  id: AgentType;
  name: string;
  description: string;
  command: string;

  // Session management
  supportsResume: boolean;
  supportsFork: boolean;

  // Build the CLI command flags
  buildFlags(options: BuildFlagsOptions): string[];

  // Status detection patterns
  waitingPatterns: RegExp[];
  runningPatterns: RegExp[];
  idlePatterns: RegExp[];

  // Session ID detection (optional - not all CLIs support this)
  getSessionId?: (projectPath: string) => string | null;

  // Config directory
  configDir: string;
}

export interface BuildFlagsOptions {
  sessionId?: string | null; // For resume
  parentSessionId?: string | null; // For fork
  skipPermissions?: boolean;
  model?: string;
}

// Common spinner characters used across CLIs
const SPINNER_CHARS = /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/;

/**
 * Claude Code Provider
 * Anthropic's official CLI for Claude
 */
export const claudeProvider: AgentProvider = {
  id: "claude",
  name: "Claude Code",
  description: "Anthropic's official CLI",
  command: "claude",
  configDir: "~/.claude",

  supportsResume: true,
  supportsFork: true,

  buildFlags(options: BuildFlagsOptions): string[] {
    const flags: string[] = [];

    if (options.skipPermissions) {
      flags.push("--dangerously-skip-permissions");
    }

    if (options.sessionId) {
      flags.push(`--resume ${options.sessionId}`);
    } else if (options.parentSessionId) {
      flags.push(`--resume ${options.parentSessionId}`);
      flags.push("--fork-session");
    }

    return flags;
  },

  waitingPatterns: [
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /Allow\?/i,
    /Approve\?/i,
    /Continue\?/i,
    /Press Enter/i,
    /waiting for/i,
    /\(yes\/no\)/i,
    /Do you want to/i,
    /Esc to cancel/i,
    />\s*1\.\s*Yes/, // Claude's approval menu
    /Yes, allow all/i,
    /allow all edits/i,
    /allow all commands/i,
  ],

  runningPatterns: [
    /thinking/i,
    /Working/i,
    /Reading/i,
    /Writing/i,
    /Searching/i,
    /Running/i,
    /Executing/i,
    SPINNER_CHARS,
  ],

  idlePatterns: [
    /^>\s*$/m,
    /claude.*>\s*$/im,
    /✻\s*Sautéed/i, // Claude finished processing
    /✻\s*Done/i,
  ],
};

/**
 * Codex Provider
 * OpenAI's CLI for code generation
 */
export const codexProvider: AgentProvider = {
  id: "codex",
  name: "Codex",
  description: "OpenAI's CLI",
  command: "codex",
  configDir: "~/.codex",

  supportsResume: false, // Codex doesn't have explicit resume
  supportsFork: false,

  buildFlags(options: BuildFlagsOptions): string[] {
    const flags: string[] = [];

    // Codex uses approval-mode instead of skip-permissions
    if (options.skipPermissions) {
      flags.push("--approval-mode full-auto");
    }

    if (options.model) {
      flags.push(`--model ${options.model}`);
    }

    return flags;
  },

  waitingPatterns: [
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /approve/i,
    /confirm/i,
    /Press Enter/i,
    /\(yes\/no\)/i,
  ],

  runningPatterns: [/thinking/i, /processing/i, /generating/i, SPINNER_CHARS],

  idlePatterns: [/^>\s*$/m, /codex.*>\s*$/im, /\$\s*$/m],
};

/**
 * OpenCode Provider
 * Open-source AI coding CLI with multi-provider support
 */
export const opencodeProvider: AgentProvider = {
  id: "opencode",
  name: "OpenCode",
  description: "Multi-provider AI CLI",
  command: "opencode",
  configDir: "~/.opencode.json",

  supportsResume: false, // OpenCode manages sessions internally via SQLite
  supportsFork: false,

  buildFlags(options: BuildFlagsOptions): string[] {
    const flags: string[] = [];

    // OpenCode uses --prompt for non-interactive, but we want interactive mode
    // So we typically don't add flags for interactive use

    if (options.skipPermissions) {
      // OpenCode doesn't have a skip permissions flag
      // It manages this via config
    }

    return flags;
  },

  waitingPatterns: [
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /confirm/i,
    /Press Enter/i,
    /\(yes\/no\)/i,
  ],

  runningPatterns: [/thinking/i, /processing/i, /working/i, SPINNER_CHARS],

  idlePatterns: [/^>\s*$/m, /opencode.*>\s*$/im, /\$\s*$/m],
};

/**
 * Gemini CLI Provider
 * Google's AI coding CLI powered by Gemini models
 */
export const geminiProvider: AgentProvider = {
  id: "gemini",
  name: "Gemini CLI",
  description: "Google's AI CLI",
  command: "gemini",
  configDir: "~/.gemini",

  supportsResume: false,
  supportsFork: false,

  buildFlags(options: BuildFlagsOptions): string[] {
    const flags: string[] = [];

    if (options.model) {
      flags.push(`-m ${options.model}`);
    }

    // Gemini CLI doesn't have a skip-permissions flag
    // It may use a different approval mechanism

    return flags;
  },

  waitingPatterns: [
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /approve/i,
    /confirm/i,
    /Press Enter/i,
    /\(yes\/no\)/i,
    /Do you want to/i,
  ],

  runningPatterns: [
    /thinking/i,
    /processing/i,
    /working/i,
    /generating/i,
    SPINNER_CHARS,
  ],

  idlePatterns: [/^>\s*$/m, /gemini.*>\s*$/im, /\$\s*$/m],
};

// Provider registry
export const providers: Record<AgentType, AgentProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
  opencode: opencodeProvider,
  gemini: geminiProvider,
};

// Get provider by ID
export function getProvider(agentType: AgentType): AgentProvider {
  return providers[agentType] || claudeProvider;
}

// Get all providers as array
export function getAllProviders(): AgentProvider[] {
  return Object.values(providers);
}

// Type guard
export function isValidAgentType(value: string): value is AgentType {
  return value === "claude" || value === "codex" || value === "opencode" || value === "gemini";
}
