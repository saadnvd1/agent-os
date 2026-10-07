// REST against one machine. A paired phone sends its token as a bearer;
// on loopback or the tailnet the server lets us in without one.
import type { Machine } from "~/lib/machines/store";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type Target = Pick<Machine, "url" | "token"> & { id?: string };

// Set by the machines layer: finds another address for a machine that
// stopped answering, or null when none does.
let failover: ((id: string) => Promise<Target | null>) | null = null;
export function setFailover(fn: typeof failover) {
  failover = fn;
}

export function authHeaders(machine: Target): Record<string, string> {
  return machine.token ? { Authorization: `Bearer ${machine.token}` } : {};
}

type Init = { method?: string; body?: unknown; timeoutMs?: number };

// A request that can't reach the machine tries its other addresses once.
export async function api<T>(
  machine: Target,
  path: string,
  init: Init = {}
): Promise<T> {
  try {
    return await request<T>(machine, path, init);
  } catch (err) {
    if (
      !(err instanceof ApiError) ||
      err.status !== 0 ||
      !machine.id ||
      !failover
    )
      throw err;
    const moved = await failover(machine.id);
    if (!moved || moved.url === machine.url) throw err;
    return request<T>(moved, path, init);
  }
}

async function request<T>(
  machine: Target,
  path: string,
  init: Init
): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(machine.url + path, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...authHeaders(machine),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      // The token is the only credential: never the shared cookie jar,
      // whose cookies would cross between machines on one host.
      credentials: "omit",
      signal: abort.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok)
      throw new ApiError(
        data?.error ?? `Request failed (${res.status})`,
        res.status
      );
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      abort.signal.aborted
        ? "The machine didn't answer in time."
        : "Can't reach the machine.",
      0
    );
  } finally {
    clearTimeout(timer);
  }
}
