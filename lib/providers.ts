/**
 * Agent Provider Abstraction
 *
 * How AgentOS launches each AI coding CLI in a terminal. What each CLI
 * accepts lives in the registry (lib/providers/registry.ts); this turns it
 * into a command line.
 */

import {
  AGENT_DEFAULT_MODEL,
  type ProviderDefinition,
  type ProviderId,
  getAllProviderDefinitions,
  getProviderDefinition,
  isValidProviderId,
} from "./providers/registry";

export type AgentType = ProviderId;

export interface AgentProvider {
  id: AgentType;
  name: string;
  description: string;
  command: string;
  supportsResume: boolean;
  supportsFork: boolean;
  configDir: string;
  // Shell that signs in first when the CLI isn't, or "".
  preamble: string;
  // The CLI's arguments, each already quoted for the shell.
  buildFlags(options: BuildFlagsOptions): string[];
}

export interface BuildFlagsOptions {
  sessionId?: string | null; // For resume
  parentSessionId?: string | null; // For fork
  skipPermissions?: boolean;
  autoApprove?: boolean; // Use auto-approve flag from registry
  model?: string | null;
  initialPrompt?: string; // Initial prompt to send to agent
}

// The arguments for one CLI, in the order it needs them: resume or fork
// first (Codex and Amp take them as subcommands), the prompt last.
export function buildArgs(
  def: ProviderDefinition,
  options: BuildFlagsOptions
): string[] {
  const args: string[] = [...(def.subcommand ?? [])];
  if (options.sessionId && def.resumeArgs) {
    args.push(...def.resumeArgs(options.sessionId));
  } else if (options.parentSessionId && def.forkArgs) {
    args.push(...def.forkArgs(options.parentSessionId));
  }
  args.push(...(def.defaultArgs ?? []));
  if ((options.skipPermissions || options.autoApprove) && def.autoApproveFlag)
    args.push(def.autoApproveFlag);
  const model = options.model?.trim();
  if (model && model !== AGENT_DEFAULT_MODEL && def.modelFlag)
    args.push(def.modelFlag, model);
  const prompt = options.initialPrompt?.trim();
  if (prompt && def.initialPromptFlag !== undefined) {
    if (def.initialPromptFlag) args.push(def.initialPromptFlag);
    args.push(prompt);
  }
  return args;
}

// Imported by the browser too, so no Node modules here.
const SAFE_ARG = /^[\w@%+=:,./-]+$/;
const quoteArg = (arg: string) =>
  SAFE_ARG.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

// Stops at a failed sign-in, so the pane shows why instead of a CLI that waits.
function signInPreamble(def: ProviderDefinition): string {
  if (!def.signIn) return "";
  const cli = quoteArg(def.cli);
  const run = (args: string[]) => [cli, ...args.map(quoteArg)].join(" ");
  return `{ ${run(def.signIn.check)} >/dev/null 2>&1 || ${run(def.signIn.login)}; } && `;
}

function toProvider(def: ProviderDefinition): AgentProvider {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    command: def.cli,
    supportsResume: def.supportsResume,
    supportsFork: def.supportsFork,
    configDir: def.configDir,
    preamble: signInPreamble(def),
    buildFlags: (options) => buildArgs(def, options).map(quoteArg),
  };
}

export const providers = Object.fromEntries(
  getAllProviderDefinitions().map((def) => [def.id, toProvider(def)])
) as Record<AgentType, AgentProvider>;

export function getProvider(agentType: AgentType): AgentProvider {
  return providers[agentType] || providers.claude;
}

export function getAllProviders(): AgentProvider[] {
  return Object.values(providers);
}

export function isValidAgentType(value: string): value is AgentType {
  return isValidProviderId(value);
}

export { getProviderDefinition, getAllProviderDefinitions };
