/**
 * Another machine's own AgentOS, reached over the network with a device token
 * this machine paired with. Tasks there run on its scheduler, not over ssh.
 */

import { getDb } from "../db";
import { PeerCallError, peerCall } from "../peer/client";
import type { PinState } from "../peer/links";
import { getHost, isRemoteHost } from "./index";
import { readCappedBytes } from "./read-capped-bytes";

/** A machine linked through Connect: its pinned keys (lib/peer). */
export interface ConnectPeer {
  machineId: string;
  hostname: string;
  signPub: string;
  boxPub: string;
  state: PinState;
  suspendedReason: string | null;
}

/**
 * `token` (the default): a device token over Tailscale or ssh-reached URLs.
 * `connect`: signed, encrypted envelopes to the pinned keys; url and token
 * are unused (token is always empty).
 */
export interface HostLink {
  hostId: string;
  hostName: string;
  url: string;
  token: string;
  transport?: "token" | "connect";
  connect?: ConnectPeer;
}

interface LinkRow {
  host_id: string;
  name: string;
  kind: string;
  url: string | null;
  token: string | null;
  machine_id: string | null;
  hostname: string | null;
  sign_pub: string | null;
  box_pub: string | null;
  state: string | null;
  suspended_reason: string | null;
}

export function hostLink(hostId: string | null | undefined): HostLink | null {
  if (!isRemoteHost(hostId)) return null;
  const row = getDb()
    .prepare(
      `SELECT h.id AS host_id, h.name, h.kind, l.url, l.token, p.machine_id,
              p.hostname, p.sign_pub, p.box_pub, p.state, p.suspended_reason
         FROM hosts h
         LEFT JOIN host_links l ON l.host_id = h.id
         LEFT JOIN peer_links p ON p.host_id = h.id
        WHERE h.id = ?`
    )
    .get(hostId) as LinkRow | undefined;
  if (!row) return null;
  if (row.kind === "connect") {
    if (!row.machine_id || !row.hostname || !row.sign_pub || !row.box_pub)
      return null;
    return {
      hostId: row.host_id,
      hostName: row.name,
      url: `https://${row.hostname}`,
      token: "",
      transport: "connect",
      connect: {
        machineId: row.machine_id,
        hostname: row.hostname,
        signPub: row.sign_pub,
        boxPub: row.box_pub,
        state: row.state === "active" ? "active" : "suspended",
        suspendedReason: row.suspended_reason,
      },
    };
  }
  return row.url && row.token
    ? {
        hostId: row.host_id,
        hostName: row.name,
        url: row.url,
        token: row.token,
        transport: "token",
      }
    : null;
}

export const isConnectLink = (link: HostLink) => link.transport === "connect";

/** For the calls that only work with a token link (sockets, raw fetches). */
export function requireTokenLink(link: HostLink): HostLink {
  if (isConnectLink(link))
    throw new Error(
      `${link.hostName} is linked through Connect: this needs a Tailscale/ssh link for now`
    );
  return link;
}

export function linkedHostIds(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT host_id FROM host_links
         WHERE host_id NOT IN (SELECT id FROM hosts WHERE kind = 'connect')
       UNION SELECT p.host_id FROM peer_links p JOIN hosts h ON h.id = p.host_id
         WHERE h.kind = 'connect'`
    )
    .all() as { host_id: string }[];
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
 * Another machine's multi-line text (a chat's tail): control characters
 * other than newline and tab become spaces, and the end is kept within `cap`.
 */
export const cleanRemoteBlock = (s: unknown, cap: number): string => {
  const text = String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+$/, "");
  return text.length > cap ? `…${text.slice(text.length - cap + 1)}` : text;
};

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
  return (await readCappedBytes(res, max)).toString("utf8");
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
  let status: number;
  let text: string;
  try {
    if (isConnectLink(link)) {
      ({ status, text } = await peerCall(link, path, opts));
    } else {
      const res = await fetch(`${link.url}${path}`, {
        method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: `Bearer ${link.token}`,
          ...(opts.body !== undefined && {
            "Content-Type": "application/json",
          }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeout ?? 15000),
        redirect: "error",
      });
      status = res.status;
      text = await readCapped(res);
    }
  } catch (err) {
    if (err instanceof PeerCallError && err.refused)
      throw new HostApiError(
        `${link.hostName}: ${cleanRemoteText(err.message)}`,
        true,
        err.status
      );
    throw unknown(err);
  }
  let data: { error?: unknown } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (status < 200 || status > 299) {
    // Only AgentOS's own refusal (a 4xx with its error) means nothing happened.
    const refused = status >= 400 && status < 500 && !!data?.error;
    throw new HostApiError(
      `${link.hostName}: ${cleanRemoteText(data?.error) || `HTTP ${status}`}`,
      refused,
      status
    );
  }
  if (!data) throw unknown(new Error("its answer wasn't JSON"));
  return data as T;
}
