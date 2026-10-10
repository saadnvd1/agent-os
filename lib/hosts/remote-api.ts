/**
 * Another machine's own AgentOS, reached over the network with a device token
 * this machine paired with. Tasks there run on its scheduler, not over ssh.
 */

import { getDb } from "../db";
import { getHost, isRemoteHost } from "./index";

export interface HostLink {
  hostId: string;
  hostName: string;
  url: string;
  token: string;
}

export function hostLink(hostId: string | null | undefined): HostLink | null {
  if (!isRemoteHost(hostId)) return null;
  const row = getDb()
    .prepare(
      `SELECT l.host_id, l.url, l.token, h.name FROM host_links l
         JOIN hosts h ON h.id = l.host_id WHERE l.host_id = ?`
    )
    .get(hostId) as
    | { host_id: string; url: string; token: string; name: string }
    | undefined;
  return row
    ? {
        hostId: row.host_id,
        hostName: row.name,
        url: row.url,
        token: row.token,
      }
    : null;
}

export function linkedHostIds(): Set<string> {
  const rows = getDb().prepare(`SELECT host_id FROM host_links`).all() as {
    host_id: string;
  }[];
  return new Set(rows.map((r) => r.host_id));
}

export function saveHostLink(hostId: string, url: string, token: string) {
  if (!getHost(hostId) || !isRemoteHost(hostId))
    throw new Error("Unknown machine");
  getDb()
    .prepare(
      `INSERT INTO host_links (host_id, url, token) VALUES (?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET url = excluded.url,
         token = excluded.token, linked_at = datetime('now')`
    )
    .run(hostId, url, token);
}

export function requireHostLink(hostId: string): HostLink {
  const link = hostLink(hostId);
  if (!link) {
    const name = getHost(hostId)?.name ?? "That machine";
    throw new Error(
      `${name} isn't linked to its AgentOS yet. Link it in Machines.`
    );
  }
  return link;
}

/** Another machine's text, safe to show and log: no control characters, short. */
export const cleanRemoteText = (s: unknown): string =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, 300);

/**
 * Why a call failed. `refused`: that AgentOS answered and said no, so nothing
 * happened there. Otherwise the outcome is unknown (unreachable, timed out,
 * cut off, a proxy error): it may have happened.
 */
export class HostApiError extends Error {
  constructor(
    message: string,
    readonly refused: boolean,
    readonly status?: number
  ) {
    super(message);
  }
}

const MAX_RESPONSE_BYTES = 80 * 1024 * 1024;

/** The body as text, read no further than max bytes whatever it claims. */
export async function readCapped(
  res: Response,
  max = MAX_RESPONSE_BYTES
): Promise<string> {
  if (Number(res.headers.get("content-length")) > max)
    throw new Error("its answer is too large");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("its answer is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A JSON call to the other machine's AgentOS; its error text on failure. */
export async function hostApi<T>(
  link: HostLink,
  path: string,
  opts: { method?: string; body?: unknown; timeout?: number } = {}
): Promise<T> {
  const unknown = (err: unknown) =>
    new HostApiError(
      `Can't reach AgentOS on ${link.hostName}: ${cleanRemoteText(err instanceof Error ? err.message : err)}`,
      false
    );
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${link.url}${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${link.token}`,
        ...(opts.body !== undefined && { "Content-Type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeout ?? 15000),
      redirect: "error",
    });
    text = await readCapped(res);
  } catch (err) {
    throw unknown(err);
  }
  let data: { error?: unknown } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    // Only AgentOS's own refusal (a 4xx with its error) means nothing happened.
    const refused = res.status >= 400 && res.status < 500 && !!data?.error;
    throw new HostApiError(
      `${link.hostName}: ${cleanRemoteText(data?.error) || `HTTP ${res.status}`}`,
      refused,
      res.status
    );
  }
  if (!data) throw unknown(new Error("its answer wasn't JSON"));
  return data as T;
}
