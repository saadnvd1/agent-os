/**
 * Where a model runs. A provider is config: Anthropic through the Claude
 * login (no key), or an Anthropic- or OpenAI-compatible endpoint with a base
 * URL, a reference to its key and its model names. The key itself is never
 * here: only where to fetch it from at launch (lib/models/secrets).
 * Imported by the browser too, so no Node modules here.
 */

import { ANTHROPIC } from "./roles";

// Where a provider's key lives. Never the key.
export type SecretRef =
  | { kind: "tokenvault"; project: string; desc?: string }
  | { kind: "keychain"; service: string; account?: string }
  | { kind: "env"; name: string };

export type ProviderApi = "anthropic" | "openai";

export interface ModelTiers {
  opus?: string;
  sonnet?: string;
  haiku?: string;
}

export interface ModelProvider {
  id: string;
  label: string;
  api: ProviderApi;
  // Absent for Anthropic itself, which uses the Claude login.
  baseUrl?: string;
  auth?: SecretRef;
  // How the key is sent: Authorization: Bearer, or x-api-key.
  authHeader?: "bearer" | "x-api-key";
  models: string[];
  // Claude Code's tiers mapped to this provider's models, so subagents and
  // background work (which ask for "haiku" or "sonnet") route here too.
  tiers?: ModelTiers;
  // Plain settings the endpoint wants (a longer timeout, say). Never a key.
  env?: Record<string, string>;
  enabled: boolean;
}

export interface ModelPrice {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const ANTHROPIC_PROVIDER: ModelProvider = {
  id: ANTHROPIC,
  label: "Anthropic (Claude login)",
  api: "anthropic",
  models: [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-4-5-20251001",
    "claude-fable-5-1",
  ],
  enabled: true,
};

// Checked against each provider's docs on 2026-10-11: DeepSeek
// (api-docs.deepseek.com/guides/anthropic_api) and Z.ai
// (docs.z.ai/devpack/tool/claude). Off until a key reference is set.
export const PROVIDER_PRESETS: ModelProvider[] = [
  ANTHROPIC_PROVIDER,
  {
    id: "deepseek",
    label: "DeepSeek",
    api: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic",
    authHeader: "x-api-key",
    models: ["deepseek-v4-pro", "deepseek-flash"],
    tiers: {
      opus: "deepseek-v4-pro",
      sonnet: "deepseek-flash",
      haiku: "deepseek-flash",
    },
    enabled: false,
  },
  {
    id: "zai",
    label: "Z.ai (GLM)",
    api: "anthropic",
    baseUrl: "https://api.z.ai/api/anthropic",
    authHeader: "bearer",
    models: ["glm-5.3", "glm-5.3-flash"],
    tiers: { opus: "glm-5.3", sonnet: "glm-5.3", haiku: "glm-5.3-flash" },
    env: { API_TIMEOUT_MS: "3000000" },
    enabled: false,
  },
];

// Dollars per million tokens, from each provider's price page on
// 2026-10-11. DeepSeek and GLM have no cache-write price (a write costs
// what input does), and DeepSeek's are its peak prices.
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-opus-5-5": {
    input: 4,
    cacheWrite: 5,
    cacheRead: 0.2,
    output: 20,
  },
  "anthropic/claude-sonnet-5-5": {
    input: 2,
    cacheWrite: 2.5,
    cacheRead: 0.1,
    output: 10,
  },
  "anthropic/claude-haiku-4-5-20251001": {
    input: 1,
    cacheWrite: 1.25,
    cacheRead: 0.1,
    output: 5,
  },
  "anthropic/claude-fable-5-1": {
    input: 10,
    cacheWrite: 12.5,
    cacheRead: 0.25,
    output: 50,
  },
  "deepseek/deepseek-v4-pro": {
    input: 1.32,
    cacheWrite: 1.32,
    cacheRead: 0.044,
    output: 3.96,
  },
  "deepseek/deepseek-flash": {
    input: 0.3,
    cacheWrite: 0.3,
    cacheRead: 0.006,
    output: 1.2,
  },
  "zai/glm-5.3": { input: 1.4, cacheWrite: 1.4, cacheRead: 0.26, output: 4.4 },
  "zai/glm-5.3-flash": {
    input: 0.15,
    cacheWrite: 0.15,
    cacheRead: 0.03,
    output: 0.5,
  },
};

// Claude Code's family aliases, priced as the model each stands for.
export const ANTHROPIC_ALIASES: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5-20251001",
  fable: "claude-fable-5-1",
};

// Anthropic is billed by the plan, not per token: a turn there costs a share
// of the plan's window, and its dollars are what the API would have charged.
export const isMetered = (providerId: string) => providerId !== ANTHROPIC;

export function describeSecretRef(ref: SecretRef | undefined): string {
  if (!ref) return "no key";
  if (ref.kind === "tokenvault")
    return `tokenvault ${ref.project}${ref.desc ? ` "${ref.desc}"` : ""}`;
  if (ref.kind === "keychain")
    return `Keychain ${ref.service}${ref.account ? ` (${ref.account})` : ""}`;
  return `$${ref.name}`;
}
