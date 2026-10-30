/**
 * What Connect sends down. Only the types below are accepted, and only for a
 * share this machine minted and still holds. Everything else is dropped and
 * counted: nothing downward is executed or interpreted, and only a Drive
 * prompt from the guest this machine gave the wheel reaches an agent
 * (./drive decides). No type answers an approval, sets the level or moves
 * the wheel: those come only from the host's own API.
 */

import { z } from "zod";
import { cleanBody, cleanName } from "./clean";
import { chunk } from "./ring";
import {
  admittedGuestIds,
  hasJoinRequest,
  hasSuggestion,
  logLive,
  markLiveEnded,
  openSuggestions,
  setLevel,
} from "./store";
import { MAX_LOBBY, MAX_PENDING_CARDS, live, type Runtime } from "./runtime";
import { acceptPrompt, setWheel, stopPrompt } from "./drive";

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
  "access_failed",
  "drive_prompt",
  "drive_stop",
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
  access_failed: z.object({ reason: z.string().max(200).optional() }),
  drive_prompt: z.object({ id, guest, text: z.string().max(16000) }),
  drive_stop: z.object({ id, guest }),
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
        else if (g.status === "pending") {
          if (!rt.guests.has(g.id) && pendingCount(rt) >= MAX_LOBBY) continue;
          setGuest(rt, g.id, name, "pending", now);
        }
      }
      return true;
    }
    case "join_request": {
      const g = (parsed.data as z.infer<typeof SCHEMAS.join_request>).guest;
      const name = cleanName(g.name);
      if (!name) return (drop("bad name"), false);
      if (rt.guests.has(g.id)) return true;
      if (pendingCount(rt) >= MAX_LOBBY) {
        fx.send(shareId, "deny", { guest_id: g.id });
        return true;
      }
      setGuest(rt, g.id, name, "pending", now);
      if (!hasJoinRequest(shareId, g.id))
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
      if (rt.drive.wheel?.guestId === g.id) setWheel(rt, null, "left", fx);
      if (known.status === "pending") rt.guests.delete(g.id);
      else known.online = false;
      return true;
    }
    case "suggestion": {
      const s = parsed.data as z.infer<typeof SCHEMAS.suggestion>;
      // Watch guests can't suggest. Connect refuses first; this is the machine's own check.
      if (rt.share.level === "watch")
        return (drop("suggestion on a watch-only share"), false);
      const known = rt.guests.get(s.guest.id);
      // Only a guest this machine let in can leave a card.
      if (!known || known.status !== "admitted")
        return (drop("suggestion from a guest not admitted here"), false);
      const text = cleanBody(s.text);
      if (!text) return (drop("empty suggestion"), false);
      if (hasSuggestion(shareId, s.id))
        return (drop("duplicate suggestion"), false);
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
      // The admit line must not outlive a refused admit.
      if (gid && admittedGuestIds(shareId).has(gid))
        logLive({
          share_id: shareId,
          kind: "deny",
          guest_id: gid,
          guest_name: g?.name ?? null,
          ref: null,
          text: null,
          sent_text: null,
        });
      rt.notice = "Your plan's guest limit is reached.";
      return true;
    }
    case "access_failed": {
      const why = (parsed.data as z.infer<typeof SCHEMAS.access_failed>).reason;
      rt.notice = why
        ? why.replace(/\s+/g, " ").trim().slice(0, 160)
        : "Connect refused that access level.";
      // Connect didn't take it: this machine goes back to the safer side.
      if (rt.drive.wheel) setWheel(rt, null, "taken_back", fx);
      if (rt.share.level === "drive") {
        rt.share = { ...rt.share, level: "suggest" };
        setLevel(shareId, "suggest");
        fx.send(shareId, "access", { level: "suggest" });
      }
      return true;
    }
    case "drive_prompt":
      return acceptPrompt(
        rt,
        parsed.data as z.infer<typeof SCHEMAS.drive_prompt>,
        fx,
        now
      )
        ? true
        : (drop("duplicate drive prompt"), false);
    case "drive_stop":
      return stopPrompt(
        rt,
        parsed.data as z.infer<typeof SCHEMAS.drive_stop>,
        fx
      )
        ? true
        : (drop("stop from a guest not driving"), false);
    case "invalid":
      rt.drops++;
      return true;
  }
  return false;
}

function pendingCount(rt: Runtime) {
  return [...rt.guests.values()].filter((x) => x.status === "pending").length;
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
