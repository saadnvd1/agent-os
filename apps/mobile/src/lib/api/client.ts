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

type Target = Pick<Machine, "url" | "token">;

export function authHeaders(machine: Target): Record<string, string> {
  return machine.token ? { Authorization: `Bearer ${machine.token}` } : {};
}

export async function api<T>(
  machine: Target,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
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
