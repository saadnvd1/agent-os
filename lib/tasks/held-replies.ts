/**
 * What the tasks this machine's orchestrators moved to a linked machine say
 * to those orchestrators. That machine only stores the messages (bus/held-reply);
 * this machine, which polls, pulls them and delivers each as that task's own
 * message to the orchestrator that started it. Who receives it is this
 * machine's own record (started_by), never anything the other machine names.
 */

import { db, type Session } from "../db";
import { sendMessage } from "../bus";
import type { HostLink } from "../hosts/remote-api";
import * as client from "./contract/client";

const PULL_EVERY_MS = 5000;
const MISSING_FOR_MS = 10 * 60 * 1000;
const MAX_BODY = 8000;

const g = globalThis as unknown as {
  __agentosRepliesAt?: Map<string, number>;
  __agentosRepliesBusy?: Set<string>;
};
const lastAsked = (g.__agentosRepliesAt ??= new Map());
const busy = (g.__agentosRepliesBusy ??= new Set());

interface Pulled {
  id: number;
  fromId: string;
  body: string;
}

// Held means an orchestrator started it, as isHeldRemote reads it (contract/held-calls.ts).
const HELD_BY = `started_by IN (SELECT id FROM sessions WHERE role = 'orchestrator')`;

const heldMirror = (hostId: string, id: string) =>
  db
    .prepare(
      `SELECT * FROM session_rows WHERE id = ? AND host_id = ?
         AND ${HELD_BY} AND task_status IN ('running', 'moving')`
    )
    .get(id, hostId) as Session | undefined;

export function hasHeldMirrors(hostId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM session_rows WHERE host_id = ? AND ${HELD_BY}
         AND task_prompt IS NOT NULL AND task_status IN ('running', 'moving')`
    )
    .get(hostId);
}

/** Delivers what the link's machine holds for this machine's orchestrators. */
export async function pullHeldReplies(link: HostLink): Promise<number> {
  const hostId = link.hostId;
  if (busy.has(hostId) || !hasHeldMirrors(hostId)) return 0;
  const now = Date.now();
  if (now - (lastAsked.get(hostId) ?? 0) < PULL_EVERY_MS) return 0;
  lastAsked.set(hostId, now);
  busy.add(hostId);
  try {
    let messages: Pulled[];
    try {
      const res = await client.replies(link);
      messages = (Array.isArray(res.messages) ? res.messages : []).filter(
        (m): m is Pulled =>
          !!m &&
          Number.isSafeInteger(m.id) &&
          typeof m.fromId === "string" &&
          typeof m.body === "string"
      );
    } catch (err) {
      // A machine that predates replies: leave it alone for a while.
      if ((err as { status?: number }).status === 404)
        lastAsked.set(hostId, now + MISSING_FOR_MS);
      return 0;
    }
    const handled: number[] = [];
    let delivered = 0;
    for (const m of messages) {
      const mirror = heldMirror(hostId, m.fromId);
      if (!mirror) {
        handled.push(m.id); // nothing here to deliver it from
        continue;
      }
      try {
        await sendMessage({
          fromId: mirror.id,
          to: mirror.started_by!,
          body: m.body.slice(0, MAX_BODY),
          relayKey: `${hostId}:${m.id}`,
        });
        handled.push(m.id);
        delivered++;
      } catch {
        // Gone, or rate limited: offered again at the next pull.
      }
    }
    if (handled.length)
      await client.ackReplies(link, handled).catch(() => undefined);
    return delivered;
  } finally {
    busy.delete(hostId);
  }
}
