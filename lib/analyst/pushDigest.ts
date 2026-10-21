import type { ChatItem } from "../chat/events";
import { hasItem, itemsAfter, lastItems } from "../chat/store";
import { listQueue } from "../chat/queued";
import { sendChat } from "../chat/runner";
import { db } from "../db";
import { buildDigest } from "./buildDigest";
import { dropPendingDigest, getLink, markDigestPending } from "./store";
import type { AnalystLink } from "./types";

// How far back a first review, or a review of the same turn again, reads.
const LAST_TURN_ITEMS = 400;

export const digestPrefix = (linkId: string) => `user-analyst-${linkId}-`;

const sessionName = (id: string) =>
  (
    db.prepare(`SELECT name FROM sessions WHERE id = ?`).get(id) as
      { name: string } | undefined
  )?.name ?? "coding agent";

const lastTurnEnd = (items: ChatItem[]) =>
  items.findLastIndex((i) => i.kind === "turn_end");

// The latest finished turn: from after the turn_end before it.
function lastTurn(sessionId: string): ChatItem[] {
  const items = lastItems(sessionId, LAST_TURN_ITEMS);
  const end = lastTurnEnd(items);
  if (end < 0) return [];
  const before = items
    .slice(0, end)
    .findLastIndex((i) => i.kind === "turn_end");
  return items.slice(before + 1, end + 1);
}

// The coding agent's finished turns the analyst hasn't reviewed.
export function unreviewedTurns(link: AnalystLink): ChatItem[] {
  if (!link.reviewedThrough) return lastTurn(link.coderSessionId);
  const items = itemsAfter(link.coderSessionId, link.reviewedThrough);
  return items.slice(0, lastTurnEnd(items) + 1);
}

// The turns a pending digest covers: after the cursor, up to its end.
function pendingTurns(link: AnalystLink): ChatItem[] {
  const items = link.reviewedThrough
    ? itemsAfter(link.coderSessionId, link.reviewedThrough)
    : lastItems(link.coderSessionId, LAST_TURN_ITEMS);
  const end = items.findIndex((i) => i.id === link.pendingThrough);
  if (end < 0) return [];
  if (link.reviewedThrough) return items.slice(0, end + 1);
  const before = items
    .slice(0, end)
    .findLastIndex((i) => i.kind === "turn_end");
  return items.slice(before + 1, end + 1);
}

const taken = (sessionId: string, id: string) =>
  hasItem(sessionId, id) || listQueue(sessionId).some((q) => q.id === id);

// A pending digest the analyst will never answer: lost before it arrived,
// or answered by a turn whose end this server didn't see (a crash).
export function pendingIsStale(link: AnalystLink): boolean {
  const id = link.pendingDigestId;
  if (!id) return false;
  if (!taken(link.analystSessionId, id)) return true;
  // Still queued: it waits its turn.
  if (!hasItem(link.analystSessionId, id)) return false;
  return itemsAfter(link.analystSessionId, id, 200).some(
    (i) => i.kind === "turn_end"
  );
}

async function send(link: AnalystLink, id: string, items: ChatItem[]) {
  const through = items[items.length - 1].id;
  const digest = buildDigest(items, {
    coderName: sessionName(link.coderSessionId),
    through,
  });
  markDigestPending(link.id, id, through, digest.signals);
  await sendChat(link.analystSessionId, {
    text: digest.text,
    id,
    queue: true,
    origin: {
      kind: "event",
      label: "Coding agent",
      sessionId: link.coderSessionId,
      body: digest.label,
    },
  });
}

export type PushResult =
  "sent" | "nothing" | "paused" | "busy" | "ended" | "interrupted";

/**
 * Sends the analyst the coding agent's turns since it last reviewed, once:
 * turns that end while it is still on a digest wait for the next one, and
 * a turn the user stopped rides along with the turn after it. `force`
 * (Review now) sends even when paused, busy or stopped, and with nothing
 * new reviews the last turn again.
 */
export async function pushDigest(
  linkId: string,
  opts: { force?: boolean } = {}
): Promise<PushResult> {
  let link = getLink(linkId);
  if (!link || link.endedAt) return "ended";
  if (link.pendingDigestId && (opts.force || pendingIsStale(link))) {
    dropPendingDigest(link.id);
    link = getLink(linkId)!;
  }
  if (!opts.force) {
    if (link.paused) return "paused";
    if (link.pendingDigestId) return "busy";
  }
  const items = unreviewedTurns(link);
  const end = items[items.length - 1];
  if (end?.kind === "turn_end") {
    if (end.interrupted && !opts.force) return "interrupted";
    await send(link, `${digestPrefix(link.id)}${end.id}`, items);
    return "sent";
  }
  if (!opts.force) return "nothing";
  const again = lastTurn(link.coderSessionId);
  if (!again.length) return "nothing";
  await send(link, `${digestPrefix(link.id)}again-${Date.now()}`, again);
  return "sent";
}

// After a restart: a digest marked pending is sent again under its id (a
// no-op when it landed).
export async function resendPending(linkId: string): Promise<boolean> {
  const link = getLink(linkId);
  if (!link?.pendingDigestId || link.endedAt) return false;
  if (taken(link.analystSessionId, link.pendingDigestId)) return false;
  const items = pendingTurns(link);
  if (!items.length) {
    dropPendingDigest(link.id);
    return false;
  }
  await send(link, link.pendingDigestId, items);
  return true;
}
