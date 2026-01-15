/**
 * Agent Provider Abstraction
 *
 * Defines interfaces and implementations for different AI coding CLI tools
 * (Claude Code, Codex, OpenCode, etc.)
 *
 * Uses centralized provider registry from lib/providers/registry.ts
 */

import {
  type ProviderId,
  type ProviderDefinition,
  getProviderDefinition,
  getAllProviderDefinitions,
  isValidProviderId,
} from "./providers/registry";

export type AgentType = ProviderId;

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
  autoApprove?: boolean; // Use auto-approve flag from registry
  model?: string;
  initialPrompt?: string; // Initial prompt to send to agent
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
    const def = getProviderDefinition("claude");
    const flags: string[] = [];

    // Auto-approve flag from registry
    if (
      (options.skipPermissions || options.autoApprove) &&
      def.autoApproveFlag
    ) {
      flags.push(def.autoApproveFlag);
    }

    // Resume/fork
    if (options.sessionId && def.resumeFlag) {
      flags.push(`${def.resumeFlag} ${options.sessionId}`);
    } else if (options.parentSessionId && def.resumeFlag) {
      flags.push(`${def.resumeFlag} ${options.parentSessionId}`);
      flags.push("--fork-session");
    }

    // Initial prompt (positional argument for Claude)
    if (options.initialPrompt?.trim() && def.initialPromptFlag !== undefined) {
      const prompt = options.initialPrompt.trim();
      // Shell-escape the prompt
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      flags.push(`'${escapedPrompt}'`);
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
    const def = getProviderDefinition("codex");
    const flags: string[] = [];

    // Auto-approve flag from registry
    if (
      (options.skipPermissions || options.autoApprove) &&
      def.autoApproveFlag
    ) {
      flags.push(def.autoApproveFlag);
    }

    if (options.model && def.modelFlag) {
      flags.push(`${def.modelFlag} ${options.model}`);
    }

    // Initial prompt (positional argument for Codex)
    if (options.initialPrompt?.trim() && def.initialPromptFlag !== undefined) {
      const prompt = options.initialPrompt.trim();
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      flags.push(`'${escapedPrompt}'`);
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
    const def = getProviderDefinition("opencode");
    const flags: string[] = [];

    // OpenCode uses --prompt for non-interactive, but we want interactive mode
    // So we typically don't add flags for interactive use

    if (options.skipPermissions) {
      // OpenCode doesn't have a skip permissions flag
      // It manages this via config
    }

    // Initial prompt (uses --prompt flag)
    if (options.initialPrompt?.trim() && def.initialPromptFlag) {
      const prompt = options.initialPrompt.trim();
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      flags.push(def.initialPromptFlag);
      flags.push(`'${escapedPrompt}'`);
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
    const def = getProviderDefinition("gemini");
    const flags: string[] = [];

    // Auto-approve flag from registry
    if (
      (options.skipPermissions || options.autoApprove) &&
      def.autoApproveFlag
    ) {
      flags.push(def.autoApproveFlag);
    }

    if (options.model && def.modelFlag) {
      flags.push(`${def.modelFlag} ${options.model}`);
    }

    // Initial prompt (uses -p flag)
    if (options.initialPrompt?.trim() && def.initialPromptFlag) {
      const prompt = options.initialPrompt.trim();
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      flags.push(def.initialPromptFlag);
      flags.push(`'${escapedPrompt}'`);
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

/**
 * Aider Provider
 * Open-source AI pair programming in the terminal
 */
export const aiderProvider: AgentProvider = {
  id: "aider",
  name: "Aider",
  description: "AI pair programming",
  command: "aider",
  configDir: "~/.aider",

  supportsResume: false,
  supportsFork: false,

  buildFlags(options: BuildFlagsOptions): string[] {
    const def = getProviderDefinition("aider");
    const flags: string[] = [];

    // Auto-approve flag from registry
    if (
      (options.skipPermissions || options.autoApprove) &&
      def.autoApproveFlag
    ) {
      flags.push(def.autoApproveFlag);
    }

    if (options.model && def.modelFlag) {
      flags.push(`${def.modelFlag} ${options.model}`);
    }

    return flags;
  },

  waitingPatterns: [
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    />\s*$/m,
    /Press Enter/i,
    /\(yes\/no\)/i,
  ],

  runningPatterns: [
    /thinking/i,
    /processing/i,
    /working/i,
    /Committing/i,
    SPINNER_CHARS,
  ],

  idlePatterns: [/^>\s*$/m, /aider.*>\s*$/im, /\$\s*$/m],
};

/**
 * Cursor CLI Provider
 * Cursor's AI agent in the terminal
 */
export const cursorProvider: AgentProvider = {
  id: "cursor",
  name: "Cursor CLI",
  description: "Cursor's AI agent",
  command: "cursor-agent",
  configDir: "~/.cursor",

  supportsResume: false,
  supportsFork: false,

  buildFlags(options: BuildFlagsOptions): string[] {
    const def = getProviderDefinition("cursor");
    const flags: string[] = [...(def.defaultArgs || [])];

    // Auto-approve flag from registry
    if (
      (options.skipPermissions || options.autoApprove) &&
      def.autoApproveFlag
    ) {
      flags.push(def.autoApproveFlag);
    }

    if (options.model && def.modelFlag) {
      flags.push(`${def.modelFlag} ${options.model}`);
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

  runningPatterns: [
    /thinking/i,
    /processing/i,
    /working/i,
    /writing/i,
    SPINNER_CHARS,
  ],

  idlePatterns: [/^>\s*$/m, /cursor.*>\s*$/im, /\$\s*$/m],
};

/**
 * Shell Provider
 * Plain terminal without any AI CLI
 */
export const shellProvider: AgentProvider = {
  id: "shell",
  name: "Terminal",
  description: "Plain shell terminal",
  command: "", // No command - just shell
  configDir: "",

  supportsResume: false,
  supportsFork: false,

  buildFlags(): string[] {
    return []; // No flags for shell
  },

  waitingPatterns: [],
  runningPatterns: [],
  idlePatterns: [/\$\s*$/m, />\s*$/m, /%\s*$/m],
};

// Provider registry
export const providers: Record<AgentType, AgentProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
  opencode: opencodeProvider,
  gemini: geminiProvider,
  aider: aiderProvider,
  cursor: cursorProvider,
  shell: shellProvider,
};

// Get provider by ID
export function getProvider(agentType: AgentType): AgentProvider {
  return providers[agentType] || claudeProvider;
}

// Get all providers as array
export function getAllProviders(): AgentProvider[] {
  return Object.values(providers);
}

// Type guard (use registry)
export function isValidAgentType(value: string): value is AgentType {
  return isValidProviderId(value);
}

// Export registry functions for convenience
export {
  getProviderDefinition,
  getAllProviderDefinitions,
} from "./providers/registry";
