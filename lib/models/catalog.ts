/**
 * The one list of models every picker shows, built on the server: each
 * enabled provider's models, and the models Pi reaches (local servers in its
 * models.json). Nothing about a model, provider or its locality is decided
 * in the browser.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { effectiveModels, type EffectiveModels } from "./config";
import { ANTHROPIC } from "./roles";
import { PI, type ModelProvider } from "./providers";
import { hostLocality, type Locality } from "./locality";
import {
  cachedAvailability,
  checkAvailability,
  probeUrl,
  type Availability,
} from "./availability";

export interface ModelChoice {
  // "anthropic/claude-opus-5-5", "pi/local/qwen3-27b"
  ref: string;
  label: string;
  // The provider's name: "Anthropic", "DeepSeek", "Pi · local".
  group: string;
  // What runs it: Claude Code, or the Pi agent.
  agent: "claude" | "pi";
  locality: Locality;
  availability: Availability;
  // May serve a merge gate: Claude Code can run it.
  gateCapable: boolean;
  // Where the server is (never a key).
  endpoint?: string;
}

interface PiProvider {
  id: string;
  baseUrl: string;
  models: { id: string; name?: string }[];
}

const piModelsFile = () =>
  process.env.AGENTOS_PI_MODELS_FILE ||
  path.join(os.homedir(), ".pi", "agent", "models.json");

// The providers in Pi's own config. A missing or unreadable file means Pi
// has no servers of ours to list.
export function piProviders(file = piModelsFile()): PiProvider[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const providers = (raw as { providers?: Record<string, unknown> })?.providers;
  if (!providers || typeof providers !== "object") return [];
  const out: PiProvider[] = [];
  for (const [id, p] of Object.entries(providers)) {
    const q = p as { baseUrl?: unknown; models?: unknown };
    if (typeof q?.baseUrl !== "string" || !Array.isArray(q.models)) continue;
    const models = q.models
      .map((m) =>
        typeof m === "string"
          ? { id: m }
          : {
              id: (m as { id?: unknown })?.id,
              name: (m as { name?: unknown })?.name,
            }
      )
      .filter(
        (m): m is { id: string; name?: string } => typeof m.id === "string"
      )
      .map((m) => ({
        id: m.id,
        ...(typeof m.name === "string" ? { name: m.name } : {}),
      }));
    out.push({ id, baseUrl: q.baseUrl, models });
  }
  return out;
}

const providerEndpoint = (p: ModelProvider) =>
  p.baseUrl ? probeUrl(p.baseUrl, p.api) : undefined;

export function modelCatalog(
  effective: EffectiveModels = effectiveModels(),
  pi: PiProvider[] = piProviders()
): ModelChoice[] {
  const out: ModelChoice[] = [];
  for (const p of effective.providers.filter((x) => x.enabled)) {
    const endpoint = providerEndpoint(p);
    const locality = hostLocality(p.baseUrl);
    const availability: Availability =
      p.id === ANTHROPIC
        ? { state: "up", checkedAt: null }
        : locality === "local" && endpoint
          ? cachedAvailability(endpoint)
          : { state: "unknown", checkedAt: null };
    for (const m of p.models)
      out.push({
        ref: `${p.id}/${m}`,
        label: m,
        group: p.label,
        agent: "claude",
        locality,
        availability,
        gateCapable: p.api === "anthropic",
        endpoint: p.baseUrl,
      });
  }
  for (const p of pi) {
    const locality = hostLocality(p.baseUrl);
    const endpoint = probeUrl(p.baseUrl, "openai");
    const availability: Availability =
      locality === "local"
        ? cachedAvailability(endpoint)
        : { state: "unknown", checkedAt: null };
    for (const m of p.models)
      out.push({
        ref: `${PI}/${p.id}/${m.id}`,
        label: m.name ?? m.id,
        group: `Pi · ${p.id}`,
        agent: "pi",
        locality,
        availability,
        gateCapable: false,
        endpoint: p.baseUrl,
      });
  }
  return out;
}

export const choiceFor = (
  ref: string,
  effective?: EffectiveModels
): ModelChoice | undefined =>
  modelCatalog(effective).find((c) => c.ref === ref);

// Whether the model's server answers now, waiting for a probe. Cloud and
// unlisted models aren't probed: they count as available.
export async function modelAvailability(
  ref: string,
  effective?: EffectiveModels,
  refresh = false
): Promise<Availability> {
  const choice = choiceFor(ref, effective);
  if (!choice || choice.locality !== "local" || !choice.endpoint)
    return { state: "unknown", checkedAt: null };
  const url =
    choice.agent === "pi"
      ? probeUrl(choice.endpoint, "openai")
      : probeUrl(choice.endpoint, "anthropic");
  return checkAvailability(url, refresh);
}
