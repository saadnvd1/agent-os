/**
 * Whether a model's server answers. Only endpoints on the local networks
 * are probed (a cloud provider's key isn't proof and a probe costs), one
 * short GET, cached for a while. Any HTTP answer means the server is up;
 * what's down is a refused connection or no answer in time.
 */

export type AvailabilityState = "up" | "down" | "unknown";

export interface Availability {
  state: AvailabilityState;
  checkedAt: string | null;
  error?: string;
}

const TTL_MS = 30_000;
const TIMEOUT_MS = 1_500;

interface Entry extends Availability {
  at: number;
}
const cache = new Map<string, Entry>();
const probing = new Map<string, Promise<Entry>>();

const UNKNOWN: Availability = { state: "unknown", checkedAt: null };

// What a server of that API lists its models at.
export const probeUrl = (baseUrl: string, api: "anthropic" | "openai") => {
  const base = baseUrl.replace(/\/+$/, "");
  return api === "anthropic" && !/\/v1$/.test(base)
    ? `${base}/v1/models`
    : `${base}/models`;
};

async function probe(url: string): Promise<Entry> {
  const at = Date.now();
  try {
    await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    return { state: "up", checkedAt: new Date(at).toISOString(), at };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    const timedOut = (error as Error).name === "TimeoutError";
    return {
      state: "down",
      checkedAt: new Date(at).toISOString(),
      at,
      error: timedOut
        ? `no answer in ${TIMEOUT_MS / 1000}s`
        : (cause ?? (error as Error).message),
    };
  }
}

const strip = ({ at: _at, ...rest }: Entry): Availability => rest;

// The last check of a URL, probing in the background when it's stale: a
// request handler never waits on a probe.
export function cachedAvailability(url: string): Availability {
  const hit = cache.get(url);
  if (!hit || Date.now() - hit.at >= TTL_MS) void checkAvailability(url);
  return hit ? strip(hit) : UNKNOWN;
}

// A fresh enough answer, waiting for the probe if there isn't one.
export async function checkAvailability(
  url: string,
  refresh = false
): Promise<Availability> {
  const hit = cache.get(url);
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return strip(hit);
  let running = probing.get(url);
  if (!running) {
    running = probe(url)
      .then((e) => {
        cache.set(url, e);
        return e;
      })
      .finally(() => probing.delete(url));
    probing.set(url, running);
  }
  return strip(await running);
}

export function clearAvailability(): void {
  cache.clear();
  probing.clear();
}
