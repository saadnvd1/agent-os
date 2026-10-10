/**
 * A chat whose session runs on a linked machine: the browser's /ws/chat here
 * is relayed to that machine's /ws/chat, which owns the conversation (its
 * worker, items and queue). Frames go through as they are, both ways; the
 * other side checks what a client sends exactly as it would for a browser of
 * its own. The browser leaving closes the other side. The other side
 * dropping is retried with backoff while the browser stays (it's told once
 * per outage), and each reconnect brings a fresh snapshot from it.
 */

import { db } from "../db";
import { hostLink, cleanRemoteText, type HostLink } from "../hosts/remote-api";
import { openPeerSocket } from "../hosts/peer-socket";
import { PEER_RETRY_MS, type PeerSocket } from "../terminal/peer-pty";
import type { ChatSocket } from "./socket";

// Frames a browser sends before the other machine answers, kept until then.
export const MAX_EARLY_FRAMES = 32;
// The other side closing with one of these (or its own 4xxx) means it: the
// browser gets it as it is. Anything else (a restart, a dropped network)
// is retried while the browser stays.
const FINAL_CODES = new Set([1000, 1008]);

/** The link to the machine a session runs on, when that machine is linked. */
export function peerChatLink(sessionId: string): HostLink | null {
  const row = db
    .prepare(`SELECT host_id FROM sessions WHERE id = ?`)
    .get(sessionId) as { host_id: string | null } | undefined;
  return row ? hostLink(row.host_id) : null;
}

export function relayChatSocket(
  ws: ChatSocket,
  link: HostLink,
  query: Record<string, string>,
  send: (data: string) => unknown,
  fail: (message: string) => void,
  open: (link: HostLink, query: Record<string, string>) => PeerSocket = (
    l,
    q
  ) => openPeerSocket(l, "/ws/chat", q)
): void {
  let closed = false;
  // Frames are held only while the first connection is on its way; during
  // an outage the browser is told they weren't sent.
  let holding = true;
  let told = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let up: PeerSocket | null = null;
  const early: string[] = [];

  const end = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    if (retry) clearTimeout(retry);
    ws.close(code, reason);
  };
  // Said once per outage, not on every retry.
  const down = (message: string) => {
    holding = false;
    early.length = 0;
    if (!told) fail(message);
    told = true;
  };

  const connect = () => {
    if (closed) return;
    let sock: PeerSocket;
    try {
      sock = open(link, query);
    } catch (err) {
      down(
        `Can't reach AgentOS on ${link.hostName}: ${cleanRemoteText(String(err))}`
      );
      return later();
    }
    up = sock;
    let opened = false;
    let refused = false;
    let error = "";
    sock.on(
      "unexpected-response",
      (_req: unknown, res: { statusCode?: number; resume?: () => void }) => {
        refused = true;
        const status = res.statusCode ?? 0;
        res.resume?.();
        sock.terminate?.();
        fail(
          status === 401 || status === 403
            ? `${link.hostName} refused this machine's link (${status}). Link it again in Machines.`
            : `${link.hostName}'s AgentOS answered ${status}`
        );
        end(1011, "peer refused");
      }
    );
    sock.on("open", () => {
      if (closed) return sock.close();
      opened = true;
      attempt = 0;
      told = false;
      holding = false;
      // The other side's snapshot follows, as on any connect.
      for (const frame of early.splice(0)) sock.send(frame);
    });
    sock.on("message", (raw: Buffer | string) => {
      if (!closed && up === sock) send(raw.toString());
    });
    sock.on("error", (err: Error) => {
      error = err?.message ?? "";
    });
    sock.on("close", (code: number, reason: Buffer | string) => {
      if (closed || refused || up !== sock) return;
      up = null;
      // Its own answer (the session is gone, a refusal, a plain goodbye)
      // goes to the browser as it is. ASCII and short: at most 123 bytes.
      if (opened && (FINAL_CODES.has(code) || (code >= 4000 && code < 5000))) {
        const why = String(reason ?? "")
          .replace(/[^\x20-\x7e]/g, "")
          .slice(0, 100);
        return end(code, why);
      }
      down(
        opened
          ? `Lost AgentOS on ${link.hostName}; reconnecting`
          : `Can't reach AgentOS on ${link.hostName}${error ? `: ${cleanRemoteText(error)}` : ""}`
      );
      later();
    });
  };

  const later = () => {
    if (closed) return;
    const wait = PEER_RETRY_MS[Math.min(attempt++, PEER_RETRY_MS.length - 1)];
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, wait);
    retry.unref?.();
  };

  ws.on("message", (raw: Buffer) => {
    if (closed) return;
    const frame = raw.toString();
    if (up?.readyState === 1) up.send(frame);
    else if (holding && early.length < MAX_EARLY_FRAMES) early.push(frame);
    else fail(`Not sent: ${link.hostName}'s AgentOS isn't connected`);
  });
  const stop = () => {
    closed = true;
    if (retry) clearTimeout(retry);
    up?.close();
  };
  ws.on("close", stop);
  ws.on("error", stop);
  connect();
}
