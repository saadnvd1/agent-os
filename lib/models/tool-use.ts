/**
 * Whether a model can call tools, which an analyst needs to read code and
 * transcripts. There is no list of it to read, so the server asks: an Ollama
 * server reports each model's capabilities (POST /api/show), and one that
 * answers without "tools" is out. Anything that can't be told (a server with
 * no such endpoint, one that doesn't answer, a cloud provider) counts as
 * able: Pi turns text tool calls into real ones, and hiding a model we can't
 * judge is worse than letting it try. Cached, and never awaited by a request
 * handler unless it asks to.
 */

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 1_500;

interface Entry {
  toolUse: boolean;
  at: number;
}
const cache = new Map<string, Entry>();
const probing = new Map<string, Promise<boolean>>();

// Where Ollama's own API lives for an OpenAI- or Anthropic-style base URL.
export const ollamaOrigin = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

const key = (origin: string, model: string) => `${origin}\n${model}`;

async function probe(origin: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    if (!res.ok) return true;
    const body = (await res.json()) as { capabilities?: unknown };
    return Array.isArray(body.capabilities)
      ? body.capabilities.includes("tools")
      : true;
  } catch {
    return true;
  }
}

// The last answer, probing in the background when it is stale.
export function cachedToolUse(origin: string, model: string): boolean {
  const k = key(origin, model);
  const hit = cache.get(k);
  if (!hit || Date.now() - hit.at >= TTL_MS) void checkToolUse(origin, model);
  return hit?.toolUse ?? true;
}

export async function checkToolUse(
  origin: string,
  model: string
): Promise<boolean> {
  const k = key(origin, model);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.toolUse;
  let running = probing.get(k);
  if (!running) {
    running = probe(origin, model)
      .then((toolUse) => {
        cache.set(k, { toolUse, at: Date.now() });
        return toolUse;
      })
      .finally(() => probing.delete(k));
    probing.set(k, running);
  }
  return running;
}

export function clearToolUse(): void {
  cache.clear();
  probing.clear();
}
