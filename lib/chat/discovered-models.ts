import os from "os";
import { discoversModels } from "../model-catalog";
import { chatDriverFor } from "./drivers";
import type { ChatModel } from "./events";

const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 30_000;

interface Entry {
  models: ChatModel[];
  at: number;
}
const cache = new Map<string, Entry>();
const loading = new Map<string, Promise<ChatModel[]>>();

const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

async function discover(agentType: string, cwd: string): Promise<ChatModel[]> {
  const driver = chatDriverFor(agentType);
  if (!driver) return [];
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new Error("Discovery timed out")),
    TIMEOUT_MS
  );
  timer.unref?.();
  try {
    const found = await Promise.race([
      driver.discover({ cwd, env: {}, signal: ac.signal }),
      new Promise<never>((_, reject) =>
        ac.signal.addEventListener("abort", () => reject(ac.signal.reason), {
          once: true,
        })
      ),
    ]);
    return found.models;
  } finally {
    clearTimeout(timer);
  }
}

// The models an agent reports for a folder, cached for a few minutes.
// `refresh` skips the cache; a failure throws and is never cached.
export async function discoveredModels(
  agentType: string,
  folder: string | null | undefined,
  refresh = false
): Promise<ChatModel[]> {
  if (!discoversModels(agentType)) return [];
  const cwd = expand(folder?.trim() || "~");
  const key = `${agentType}:${cwd}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.models;
  const running = loading.get(key);
  if (running && !refresh) return running;
  const run = discover(agentType, cwd)
    .then((models) => {
      cache.set(key, { models, at: Date.now() });
      return models;
    })
    .finally(() => {
      if (loading.get(key) === run) loading.delete(key);
    });
  loading.set(key, run);
  return run;
}

export function clearDiscoveredModels(): void {
  cache.clear();
  loading.clear();
}

// Whether the agent reports this model. A failed discovery says no, so a
// launch falls back to the agent's default rather than failing.
export async function isDiscoveredModel(
  agentType: string,
  folder: string | null | undefined,
  model: string
): Promise<boolean> {
  try {
    return (await discoveredModels(agentType, folder)).some(
      (m) => m.value === model
    );
  } catch {
    return false;
  }
}
