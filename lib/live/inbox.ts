/**
 * What Connect sends down. Only the types below are accepted, and only for a
 * share this machine minted and still holds. Everything else is dropped and
 * counted: nothing downward is executed, interpreted or sent on to an agent.
 */

import { z } from "zod";
import { cleanBody, cleanName } from "./clean";
import { chunk } from "./ring";
import {
  admittedGuestIds,
  logLive,
  markLiveEnded,
  openSuggestions,
} from "./store";
import { MAX_LOBBY, MAX_PENDING_CARDS, live, type Runtime } from "./runtime";

export const DOWNWARD = [
  "roster",
  "join_request",
  "presence",
  "suggestion",
  "guest_left",
  "ended",
  "slow_down",
  "invalid",
  "admit_failed",
] as const;

const id = z.string().min(1).max(64);
const guest = z.object({ id, name: z.string().max(400) });

const SCHEMAS = {
  roster: z.object({
    guests: z.array(guest.extend({ status: z.string().max(32) })).max(100),
  }),
  join_request: z.object({ guest }),
  presence: z.object({ guest, online: z.boolean() }),
  suggestion: z.object({ id, guest, text: z.string().max(8000) }),
  guest_left: z.object({ guest }),
  ended: z.object({}),
  slow_down: z.object({}),
  invalid: z.object({}),
  admit_failed: z.object({ guest_id: id.optional(), reason: z.string() }),
} satisfies Record<(typeof DOWNWARD)[number], z.ZodType>;

export interface InboxEffects {
  send: (
    shareId: string,
    action: string,
    data?: Record<string, unknown>
  ) => void;
  /** The share is over: stop publishing and drop the subscription. */
  ended: (shareId: string) => void;
}

const dropped = { count: 0 };
export const droppedCount = () => dropped.count;

function drop(why: string) {
  dropped.count++;
  console.warn(`live: dropped a frame from Connect (${why})`);
}

/** Handles one frame for the share it arrived on. Returns whether it was used. */
export function handleFrame(
  shareId: string,
  frame: Record<string, unknown>,
  fx: InboxEffects,
  now = Date.now()
): boolean {
  const rt = live.runtimes.get(shareId);
  if (!rt || rt.share.ended_at) return (drop("unknown share"), false);
  const type = frame.type;
  if (
    typeof type !== "string" ||
    !(DOWNWARD as readonly string[]).includes(type)
  )
    return (drop("type not allowed"), false);
  if (frame.share_id !== undefined && frame.share_id !== shareId)
    return (drop("another share"), false);
  const parsed = SCHEMAS[type as keyof typeof SCHEMAS].safeParse(frame);
  if (!parsed.success) return (drop(`bad ${type}`), false);

  switch (type) {
    case "roster": {
      const admitted = admittedGuestIds(shareId);
      for (const g of (parsed.data as z.infer<typeof SCHEMAS.roster>).guests) {
        const name = cleanName(g.name);
        if (!name) continue;
        if (admitted.has(g.id)) setGuest(rt, g.id, name, "admitted", now);
        else if (g.status === "pending")
          setGuest(rt, g.id, name, "pending", now);
      }
      return true;
    }
    case "join_request": {
      const g = (parsed.data as z.infer<typeof SCHEMAS.join_request>).guest;
      const name = cleanName(g.name);
      if (!name) return (drop("bad name"), false);
      if (rt.guests.has(g.id)) return true;
      const waiting = [...rt.guests.values()].filter(
        (x) => x.status === "pending"
      ).length;
      if (waiting >= MAX_LOBBY) {
        fx.send(shareId, "deny", { guest_id: g.id });
        return true;
      }
      setGuest(rt, g.id, name, "pending", now);
      logLive({
        share_id: shareId,
        kind: "join_request",
        guest_id: g.id,
        guest_name: name,
        ref: null,
        text: null,
        sent_text: null,
      });
      return true;
    }
    case "presence": {
      const p = parsed.data as z.infer<typeof SCHEMAS.presence>;
      const known = rt.guests.get(p.guest.id);
      if (!known || known.status !== "admitted") return true;
      known.online = p.online;
      if (p.online) {
        const frames = chunk(rt.ring.list());
        for (const items of frames)
          fx.send(shareId, "catchup", { guest_id: known.id, items });
        if (!frames.length) return true;
      }
      return true;
    }
    case "guest_left": {
      const g = (parsed.data as z.infer<typeof SCHEMAS.guest_left>).guest;
      const known = rt.guests.get(g.id);
      if (!known) return true;
      if (known.status === "pending") rt.guests.delete(g.id);
      else known.online = false;
      return true;
    }
    case "suggestion": {
      const s = parsed.data as z.infer<typeof SCHEMAS.suggestion>;
      const known = rt.guests.get(s.guest.id);
      // Only a guest this machine let in can leave a card.
      if (!known || known.status !== "admitted")
        return (drop("suggestion from a guest not admitted here"), false);
      const text = cleanBody(s.text);
      if (!text) return (drop("empty suggestion"), false);
      if (openSuggestions(shareId).length >= MAX_PENDING_CARDS) {
        fx.send(shareId, "suggestion_status", {
          guest_id: known.id,
          id: s.id,
          status: "dismissed",
        });
        return true;
      }
      logLive({
        share_id: shareId,
        kind: "suggestion",
        guest_id: known.id,
        guest_name: known.name,
        ref: s.id,
        text,
        sent_text: null,
      });
      return true;
    }
    case "ended":
      markLiveEnded(shareId);
      fx.ended(shareId);
      return true;
    case "slow_down":
      rt.slowUntil = now + 5000;
      return true;
    case "admit_failed": {
      const gid = (parsed.data as z.infer<typeof SCHEMAS.admit_failed>)
        .guest_id;
      const g = gid ? rt.guests.get(gid) : undefined;
      if (g) g.status = "pending";
      rt.notice = "Your plan's guest limit is reached.";
      return true;
    }
    case "invalid":
      rt.drops++;
      return true;
  }
  return false;
}

function setGuest(
  rt: Runtime,
  id: string,
  name: string,
  status: "pending" | "admitted",
  at: number
) {
  const old = rt.guests.get(id);
  rt.guests.set(id, {
    id,
    name,
    status,
    online: old?.online ?? false,
    at: old?.at ?? at,
  });
}
