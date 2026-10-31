/**
 * The agents this machine can run and the models each offers, plus the
 * Ollama models it serves and which agent runs each. The new-session form
 * shows exactly this for the machine picked; a linked machine reports its
 * own through GET /api/machine.
 */

import { AGENT_OPTIONS } from "../agent-options";
import { getProviderDefinition } from "../providers/registry";
import { probeAgents } from "../agents/probe";
import { discoveredModels } from "../chat/discovered-models";
import {
  discoversModels,
  getDefaultModelForAgent,
  getModelOptions,
} from "../model-catalog";
import type { ChatModel } from "../chat/events";
import { ollamaModels } from "./ollama";
import { recentPicks } from "./recent";
import type { CatalogAgent, MachineCatalog, OllamaEntry } from "./types";

const DISCOVER_MS = 6000;
// Agents that can run a model served by Ollama, in the order to prefer them.
const LOCAL_RUNNERS = ["opencode", "pi", "omp"] as const;

export const TASK_REMOTE_REASON =
  "Tasks on another machine run Claude Code only";

const lastSegment = (v: string) => v.slice(v.lastIndexOf("/") + 1);

/** The runner that lists this Ollama tag among its models, if any. */
export function ollamaRunner(
  tag: string,
  byAgent: Record<string, ChatModel[]>
): OllamaEntry["runsWith"] {
  for (const agent of LOCAL_RUNNERS) {
    const models = byAgent[agent] ?? [];
    const hit =
      models.find((m) => m.value === `ollama/${tag}`) ??
      models.find(
        (m) =>
          lastSegment(m.value) === tag &&
          /ollama/i.test(`${m.value} ${m.description ?? ""}`)
      );
    if (hit) return { agent, model: hit.value };
  }
  return null;
}

async function discover(agent: string): Promise<ChatModel[]> {
  return Promise.race([
    discoveredModels(agent, null),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), DISCOVER_MS).unref?.()
    ),
  ]);
}

export async function machineCatalog(
  projectId: string | null = null
): Promise<MachineCatalog> {
  const [probes, tags] = await Promise.all([probeAgents(), ollamaModels()]);
  const found: Record<string, ChatModel[]> = {};
  const errors: Record<string, string> = {};
  const wanted = AGENT_OPTIONS.filter(
    (a) =>
      probes[a.value]?.installed &&
      (discoversModels(a.value) || LOCAL_RUNNERS.some((r) => r === a.value))
  );
  await Promise.all(
    wanted.map(async (a) => {
      if (!discoversModels(a.value)) return;
      try {
        found[a.value] = await discover(a.value);
      } catch (e) {
        errors[a.value] = e instanceof Error ? e.message : String(e);
      }
    })
  );
  const agents: CatalogAgent[] = AGENT_OPTIONS.filter(
    (a) => !getProviderDefinition(a.value)?.legacy || probes[a.value]?.installed
  ).map((a) => {
    const base = getModelOptions(a.value);
    return {
      agent: a.value,
      label: a.label,
      installed: probes[a.value]?.installed ?? false,
      auth: probes[a.value]?.auth ?? "unknown",
      hint: probes[a.value]?.hint ?? null,
      models: [...base, ...(found[a.value] ?? [])],
      defaultModel: getDefaultModelForAgent(a.value),
      taskBlocked: a.value === "claude" ? null : TASK_REMOTE_REASON,
      modelsError: errors[a.value] ?? null,
    };
  });
  return {
    agents,
    ollama: tags.map((name) => ({ name, runsWith: ollamaRunner(name, found) })),
    recent: recentPicks(projectId),
  };
}
