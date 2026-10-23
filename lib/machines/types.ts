/** What a machine reports about itself, shared by the server and the UI. */

import type { AgentType } from "../providers";
import type { AgentAuth } from "../agents/probe";

export interface CatalogModel {
  value: string;
  label: string;
  description?: string;
}

export interface CatalogAgent {
  agent: AgentType;
  label: string;
  installed: boolean;
  auth: AgentAuth;
  hint: string | null;
  models: CatalogModel[];
  defaultModel: string;
  /** Why it can't run a task on a linked machine; null when it can. */
  taskBlocked: string | null;
  /** Set when asking the agent for its models failed. */
  modelsError: string | null;
}

export interface OllamaEntry {
  /** The tag Ollama calls it, e.g. "qwen3:27b". */
  name: string;
  /** The agent and model value that runs it here; null when none can. */
  runsWith: { agent: AgentType; model: string } | null;
}

export interface MachineCatalog {
  agents: CatalogAgent[];
  ollama: OllamaEntry[];
}

export interface MachineReport {
  identity: {
    name: string;
    hostname: string;
    os: string;
    arch: string;
    connectMachineId: string | null;
    addresses: string[];
  };
  catalog: MachineCatalog;
}

/** One machine's agents as the new-session form asks for them. */
export interface HostCatalogResponse {
  catalog: MachineCatalog | null;
  /** Why there is no catalog (unlinked, unreachable, older AgentOS). */
  error: string | null;
}
