/**
 * Live shares from the host's side: mint, run, decide on guests, end.
 * Nothing a guest sends reaches an agent except through sendSuggestion,
 * which the host taps, and a Drive prompt from the guest the host gave the
 * wheel (./drive), whose turn the worker's guest gate holds to the host's taps.
 */

import { loadConnect } from "../connect/config";
import { addTap, getSession, registry } from "../chat/registry";
import { sendChatConfirmed } from "../chat/runner";
import { shareContext } from "../share/context";
import { redactForShare } from "../share/redact";
import { ShareError, createLiveRemote, revokeRemote } from "../share/connect";
import type { LiveExpiry } from "../connect/control-api";
import {
  LEVELS,
  type LiveInvite,
  type LiveLevel,
  type LiveView,
} from "./types";
import { driveView, guestActions, levelOptions } from "./levels";
import {
  driveRefusal,
  newDrive,
  onDriveMessage,
  releaseDrive,
  setWheel,
  type DriveFx,
} from "./drive";
import type { Session } from "../db";
import { listItems } from "../chat/store";
import { visible } from "../share/snapshot";
import { cleanBody } from "./clean";
import { itemMapper } from "./frames";
import { handleFrame } from "./inbox";
import { onMessage, seed, flush } from "./publisher";
import { RING_ITEMS, Ring } from "./ring";
import { LOBBY_MS, live, type Guest, type Runtime } from "./runtime";
import { LiveSocket, type WsFactory } from "./socket";
import {
  activeLiveShareFor,
  activeLiveShares,
  admittedGuestIds,
  insertLiveShare,
  logLive,
  markLiveEnded,
  openSuggestions,
  setLevel,
  type LiveShareRow,
} from "./store";

const SWEEP_MS = 60_000;

export function makeSocket(factory?: WsFactory): LiveSocket {
  return new LiveSocket({
    factory,
    files: loadConnect,
    onFrame: (shareId, frame) =>
      handleFrame(shareId, frame, {
        send: (id, action, data) => live.socket?.send(id, action, data),
        ended: (id) => stop(id),
      }),
    onConfirmed: (shareId) => {
      const rt = live.runtimes.get(shareId);
      if (!rt) return;
      live.socket?.send(shareId, "state", {
        state: stateOfSession(rt.share.session_id),
      });
    },
    onRejected: (shareId) => stop(shareId, true),
  });
}

const socket = (): LiveSocket => (live.socket ??= makeSocket());

const fx: DriveFx = {
  send: (id, action, data) => live.socket?.send(id, action, data),
};

const sessionOrNull = (id: string): Session | null => {
  try {
    return getSession(id);
  } catch {
    return null;
  }
};

function stateOfSession(sessionId: string) {
  const l = registry.live.get(sessionId);
  const s = l?.state;
  return s === "running"
    ? "working"
    : s === "waiting"
      ? "waiting_on_host"
      : "idle";
}

function attach(row: LiveShareRow): Runtime {
  const ctx = shareContext();
  const rt: Runtime = {
    share: row,
    guests: new Map(),
    ring: new Ring(),
    ctx,
    map: itemMapper(ctx),
    streaming: new Map(),
    dirty: new Map(),
    flushTimer: null,
    slowUntil: 0,
    notice: null,
    drops: 0,
    drive: newDrive(row.id),
  };
  live.runtimes.set(row.id, rt);
  try {
    seed(rt, row.session_id);
  } catch {}
  socket().subscribe(row.id);
  return rt;
}

/** Stops publishing a share and drops its connection; the row stays as history. */
function stop(shareId: string, markEnded = false): void {
  const rt = live.runtimes.get(shareId);
  if (rt) releaseDrive(rt, "ended", fx);
  if (markEnded) markLiveEnded(shareId);
  if (rt?.flushTimer) clearTimeout(rt.flushTimer);
  live.runtimes.delete(shareId);
  live.socket?.unsubscribe(shareId);
}

/** Starts the tap and re-attaches the shares this machine still holds. */
export function startLive(): void {
  if (live.started) return;
  live.started = true;
  addTap(onMessage);
  addTap((sessionId, m) => onDriveMessage(sessionId, m, fx));
  for (const row of activeLiveShares()) attach(row);
  setInterval(sweep, SWEEP_MS).unref();
}

function sweep(now = Date.now()): void {
  const active = new Set(activeLiveShares(now).map((s) => s.id));
  for (const id of [...live.runtimes.keys()]) {
    if (!active.has(id)) stop(id, true);
    else {
      const rt = live.runtimes.get(id)!;
      for (const [gid, g] of rt.guests)
        if (g.status === "pending" && now - g.at > LOBBY_MS)
          rt.guests.delete(gid);
    }
  }
}

function runtimeFor(id: string): Runtime {
  const rt = live.runtimes.get(id);
  if (!rt || rt.share.ended_at) throw new ShareError("Not found.", 404);
  return rt;
}

export async function createLive(
  sessionId: string,
  expiresIn: LiveExpiry,
  level: LiveLevel = "suggest",
  history = true
): Promise<LiveView> {
  startLive();
  const session = getSession(sessionId);
  if (level === "drive" && driveRefusal(session))
    throw new ShareError(`Drive: ${driveRefusal(session)}.`, 400);
  if (activeLiveShareFor(sessionId))
    throw new ShareError("This session already has a live link.", 409);
  const ctx = shareContext();
  const title =
    redactForShare(session.name, ctx)
      .text.replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Chat";
  const made = await createLiveRemote({ title, expiresIn, access: level });
  const row: LiveShareRow = {
    id: made.id,
    session_id: sessionId,
    title,
    url: made.url,
    ends_with_session: made.ends_with_session ? 1 : 0,
    max_guests: made.max_guests,
    created_at: new Date().toISOString(),
    expires_at: made.expires_at,
    ended_at: null,
    level,
    history: history ? 1 : 0,
  };
  insertLiveShare(row);
  attach(row);
  return viewOf(row.id)!;
}

export function changeLevel(id: string, level: LiveLevel): void {
  const rt = runtimeFor(id);
  if (!(level in LEVELS)) throw new ShareError("Unknown level.", 400);
  const option = levelOptions(sessionOrNull(rt.share.session_id)).find(
    (o) => o.value === level
  );
  if (!option?.enabled)
    throw new ShareError(
      `${LEVELS[level].label} isn't available${option?.reason ? `: ${option.reason}` : ""}.`,
      400
    );
  if (rt.share.level === level) return;
  // Synchronous and first: from here the machine treats the share as
  // `level`, so a racing Drive prompt is refused. Then what Drive left goes.
  rt.share = { ...rt.share, level };
  setLevel(id, level);
  if (level !== "drive") setWheel(rt, null, "downgraded", fx);
  rt.notice = null;
  live.socket?.send(id, "access", { level });
}

/** Gives the wheel to an admitted guest of a Drive share, or takes it back (null). */
export function giveWheel(id: string, guestId: string | null): void {
  const rt = runtimeFor(id);
  if (rt.share.level !== "drive")
    throw new ShareError("Drive is off for this share.", 409);
  if (guestId) {
    const g = rt.guests.get(guestId);
    if (g?.status !== "admitted" || !admittedGuestIds(id).has(guestId))
      throw new ShareError("That guest isn't in the session.", 404);
    const s = sessionOrNull(rt.share.session_id);
    const why = s ? driveRefusal(s) : "This session is gone";
    if (why) throw new ShareError(`Drive: ${why}.`, 409);
  }
  if ((rt.drive.wheel?.guestId ?? null) === guestId) return;
  setWheel(rt, guestId, "taken_back", fx);
  rt.notice = null;
  live.socket?.send(id, "access", {
    level: "drive",
    driver_guest_id: guestId,
  });
}

/** What the invite dialog offers for a session. */
export function inviteFor(sessionId: string): LiveInvite {
  const count = Math.min(
    visible(listItems(sessionId)).filter(
      (i) => i.kind === "user" || i.kind === "assistant"
    ).length,
    RING_ITEMS
  );
  return {
    levels: levelOptions(sessionOrNull(sessionId)),
    history: {
      label: `Include the ${count} earlier message${count === 1 ? "" : "s"}`,
      default: true,
      count,
    },
  };
}

/** Ends access: Connect disconnects every guest, then this machine lets go. */
export async function endLive(id: string): Promise<void> {
  // Before anything awaits: no Drive prompt is taken in from here.
  releaseDrive(runtimeFor(id), "ended", fx);
  await revokeRemote(id);
  markLiveEnded(id);
  stop(id);
}

function guestOf(rt: Runtime, guestId: string): Guest {
  const g = rt.guests.get(guestId);
  if (!g) throw new ShareError("That guest isn't waiting any more.", 404);
  return g;
}

function logGuest(rt: Runtime, kind: "admit" | "deny" | "kick", g: Guest) {
  logLive({
    share_id: rt.share.id,
    kind,
    guest_id: g.id,
    guest_name: g.name,
    ref: null,
    text: null,
    sent_text: null,
  });
}

export function admit(
  id: string,
  guestId: string,
  opts: { drive?: boolean } = {}
): void {
  const rt = runtimeFor(id);
  const g = guestOf(rt, guestId);
  if (g.status !== "pending") throw new ShareError("Already let in.", 409);
  if (opts.drive && rt.share.level !== "drive")
    throw new ShareError("Drive is off for this share.", 409);
  if (opts.drive && rt.drive.wheel)
    throw new ShareError("Someone else is driving.", 409);
  logGuest(rt, "admit", g);
  g.status = "admitted";
  rt.notice = null;
  live.socket?.send(id, "admit", { guest_id: g.id });
  if (opts.drive) giveWheel(id, g.id);
}

export function deny(id: string, guestId: string): void {
  const rt = runtimeFor(id);
  const g = guestOf(rt, guestId);
  if (g.status !== "pending") throw new ShareError("Already let in.", 409);
  logGuest(rt, "deny", g);
  rt.guests.delete(g.id);
  live.socket?.send(id, "deny", { guest_id: g.id });
}

export function kick(id: string, guestId: string): void {
  const rt = runtimeFor(id);
  const g = guestOf(rt, guestId);
  if (rt.drive.wheel?.guestId === g.id) setWheel(rt, null, "kicked", fx);
  logGuest(rt, "kick", g);
  rt.guests.delete(g.id);
  live.socket?.send(id, "kick", { guest_id: g.id });
}

const sending = new Set<string>();

/**
 * The only path from a guest's text to an agent: the host reviewed the card
 * (and may have edited it). The text is cleaned again first.
 */
export async function sendSuggestion(
  id: string,
  suggestionId: string,
  edited?: string
): Promise<void> {
  const rt = runtimeFor(id);
  const card = openSuggestions(id).find((s) => s.id === suggestionId);
  if (!card) throw new ShareError("That suggestion is gone.", 404);
  const text = cleanBody(edited ?? card.text);
  if (!text) throw new ShareError("The message is empty.", 400);
  const key = `${id}:${suggestionId}`;
  if (sending.has(key)) throw new ShareError("Already sending.", 409);
  sending.add(key);
  try {
    await sendChatConfirmed(rt.share.session_id, {
      text,
      origin: { kind: "guest", label: card.guestName },
    });
    logLive({
      share_id: id,
      kind: "sent",
      guest_id: card.guestId,
      guest_name: card.guestName,
      ref: card.id,
      text: null,
      sent_text: text,
    });
    live.socket?.send(id, "suggestion_status", {
      guest_id: card.guestId,
      id: card.id,
      status: "sent",
    });
  } finally {
    sending.delete(key);
  }
}

export function dismissSuggestion(id: string, suggestionId: string): void {
  runtimeFor(id);
  const card = openSuggestions(id).find((s) => s.id === suggestionId);
  if (!card) throw new ShareError("That suggestion is gone.", 404);
  logLive({
    share_id: id,
    kind: "dismissed",
    guest_id: card.guestId,
    guest_name: card.guestName,
    ref: card.id,
    text: null,
    sent_text: null,
  });
  live.socket?.send(id, "suggestion_status", {
    guest_id: card.guestId,
    id: card.id,
    status: "dismissed",
  });
}

export function viewOf(id: string, now = Date.now()): LiveView | null {
  const rt = live.runtimes.get(id);
  if (!rt || rt.share.ended_at) return null;
  const names = new Map<string, number>();
  const shown = [...rt.guests.values()].filter(
    (g) => g.status === "admitted" || now - g.at <= LOBBY_MS
  );
  for (const g of shown) {
    const k = g.name.normalize("NFKC").toLowerCase();
    names.set(k, (names.get(k) ?? 0) + 1);
  }
  const admitted = admittedGuestIds(id);
  const session = sessionOrNull(rt.share.session_id);
  const levels = levelOptions(session);
  const canDrive = !!levels.find((l) => l.value === "drive")?.enabled;
  return {
    id,
    sessionId: rt.share.session_id,
    title: rt.share.title,
    url: rt.share.url,
    expiresAt: rt.share.expires_at,
    endsWithSession: rt.share.ends_with_session === 1,
    maxGuests: rt.share.max_guests,
    connected: live.socket?.connected ?? false,
    notice: rt.notice,
    level: rt.share.level,
    levels,
    history: rt.share.history === 1,
    ...driveView(rt),
    guests: shown
      .filter((g) => g.status === "pending" || admitted.has(g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        online: g.online,
        duplicateName:
          (names.get(g.name.normalize("NFKC").toLowerCase()) ?? 0) > 1,
        actions: guestActions(rt, g, canDrive),
      })),
    suggestions: openSuggestions(id),
  };
}

export function listLive(sessionId?: string): LiveView[] {
  return [...live.runtimes.keys()]
    .map((id) => viewOf(id))
    .filter(
      (v): v is LiveView => !!v && (!sessionId || v.sessionId === sessionId)
    );
}

export { flush };
