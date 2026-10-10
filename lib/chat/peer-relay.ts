/**
 * A chat whose session runs on a linked machine: the browser's /ws/chat here
 * is relayed to that machine's /ws/chat, which owns the conversation (its
 * worker, items and queue). Frames go through as they are, both ways; the
 * other side checks what a client sends exactly as it would for a browser of
 * its own. When either end goes, so does the other, and the browser's
 * reconnect takes a fresh snapshot from the other machine.
 */

import { db } from "../db";
import { hostLink, cleanRemoteText, type HostLink } from "../hosts/remote-api";
import { openPeerSocket } from "../hosts/peer-socket";
import type { PeerSocket } from "../terminal/peer-pty";
import type { ChatSocket } from "./socket";

// Frames a browser sends before the other machine answers, kept until then.
export const MAX_EARLY_FRAMES = 32;
// Codes a server may close with; the rest (1005, 1006...) are the browser's.
const PASS_CODES = new Set([1000, 1001, 1008, 1011, 1012, 1013]);

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
  let opened = false;
  let refused = false;
  let error = "";
  const early: string[] = [];
  let up: PeerSocket;
  try {
    up = open(link, query);
  } catch (err) {
    fail(
      `Can't reach AgentOS on ${link.hostName}: ${cleanRemoteText(String(err))}`
    );
    ws.close(1011, "peer unreachable");
    return;
  }

  const end = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    ws.close(
      PASS_CODES.has(code) || (code >= 4000 && code < 5000) ? code : 1011,
      reason
    );
  };

  ws.on("message", (raw: Buffer) => {
    if (closed) return;
    const frame = raw.toString();
    if (up.readyState === 1) up.send(frame);
    else if (early.length < MAX_EARLY_FRAMES) early.push(frame);
    else fail(`Still connecting to ${link.hostName}; that wasn't sent`);
  });
  const stop = () => {
    closed = true;
    up.close();
  };
  ws.on("close", stop);
  ws.on("error", stop);

  up.on(
    "unexpected-response",
    (_req: unknown, res: { statusCode?: number; resume?: () => void }) => {
      refused = true;
      const status = res.statusCode ?? 0;
      res.resume?.();
      up.terminate?.();
      fail(
        status === 401 || status === 403
          ? `${link.hostName} refused this machine's link (${status}). Link it again in Machines.`
          : `${link.hostName}'s AgentOS answered ${status}`
      );
      end(1011, "peer refused");
    }
  );
  up.on("open", () => {
    opened = true;
    if (closed) return up.close();
    for (const frame of early.splice(0)) up.send(frame);
  });
  up.on("message", (raw: Buffer | string) => {
    if (!closed) send(raw.toString());
  });
  up.on("error", (err: Error) => {
    error = err?.message ?? "";
  });
  up.on("close", (code: number, reason: Buffer | string) => {
    if (closed || refused) return;
    if (!opened)
      fail(
        `Can't reach AgentOS on ${link.hostName}${error ? `: ${cleanRemoteText(error)}` : ""}`
      );
    // ASCII and short: a close reason is at most 123 bytes.
    const why = String(reason ?? "")
      .replace(/[^\x20-\x7e]/g, "")
      .slice(0, 100);
    end(opened ? code : 1011, why);
  });
}
