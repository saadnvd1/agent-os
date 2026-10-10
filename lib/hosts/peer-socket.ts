/**
 * A WebSocket to another machine's AgentOS, opened from this machine with
 * the device token its link keeps. The token goes in the Authorization
 * header of the upgrade, never in the URL; no Origin is sent (this is a
 * server, not a page), so the other machine's checks see what they see for
 * `aos` or curl.
 */

import { WebSocket } from "ws";
import type { HostLink } from "./remote-api";

export const PEER_HANDSHAKE_MS = 10_000;
// A long chat's snapshot is one message.
export const PEER_MAX_PAYLOAD = 64 * 1024 * 1024;

export function peerSocketUrl(
  link: Pick<HostLink, "url">,
  path: string,
  query: Record<string, string> = {}
): string {
  const url = new URL(path, link.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

export function openPeerSocket(
  link: HostLink,
  path: string,
  query: Record<string, string> = {}
): WebSocket {
  return new WebSocket(peerSocketUrl(link, path, query), {
    headers: { Authorization: `Bearer ${link.token}` },
    handshakeTimeout: PEER_HANDSHAKE_MS,
    maxPayload: PEER_MAX_PAYLOAD,
    followRedirects: false,
    perMessageDeflate: true,
  });
}
