/** The models a local Ollama serves, asked of its own API. */

const DEFAULT_URL = "http://127.0.0.1:11434";
const TIMEOUT_MS = 1500;

export function ollamaBase(
  env: Record<string, string | undefined> = process.env
): string {
  const raw = env.OLLAMA_HOST?.trim();
  if (!raw) return DEFAULT_URL;
  const url = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return url.replace(/\/+$/, "");
}

/** Model tags, or none when Ollama isn't running or doesn't answer in time. */
export async function ollamaModels(
  fetchImpl: typeof fetch = fetch,
  base = ollamaBase()
): Promise<string[]> {
  try {
    const res = await fetchImpl(`${base}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { name?: unknown }[] };
    return (body.models ?? [])
      .map((m) => (typeof m.name === "string" ? m.name : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}
