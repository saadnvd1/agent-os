import type { ChatItem } from "../chat/events";
import { lastItems } from "../chat/store";
import { parseReview, REVIEW_FENCE } from "./parseReview";
import { digestPrefix, pushDigest } from "./pushDigest";
import {
  getLink,
  insertRecommendation,
  liveLinkFor,
  recommendationFor,
  settleDigest,
} from "./store";
import type { AnalystLink, Recommendation } from "./types";

// Enough of the analyst's chat to hold one reply and the digest before it.
const REPLY_ITEMS = 80;

// The coding agent finished a turn: the analyst gets it, unless it's busy
// with a digest (then it comes with the next one).
export async function onCoderTurnEnd(sessionId: string): Promise<void> {
  const link = liveLinkFor(sessionId);
  if (link?.coderSessionId !== sessionId) return;
  await pushDigest(link.id);
}

interface Reply {
  // The message the turn answered.
  prompt: Extract<ChatItem, { kind: "user" }> | null;
  text: string;
  // The item the review block is in (its card renders there), else the
  // turn's end.
  itemId: string;
}

function lastReply(sessionId: string, turnEndId: string): Reply | null {
  const items = lastItems(sessionId, REPLY_ITEMS);
  const end = items.findLastIndex((i) => i.id === turnEndId);
  if (end < 0) return null;
  const start = items.slice(0, end).findLastIndex((i) => i.kind === "user");
  const turn = items.slice(start + 1, end);
  const said = turn.filter(
    (i): i is Extract<ChatItem, { kind: "assistant" }> => i.kind === "assistant"
  );
  const prompt = start >= 0 ? items[start] : null;
  return {
    prompt: prompt?.kind === "user" ? prompt : null,
    text: said.map((i) => i.text).join("\n\n"),
    itemId:
      said.findLast((i) => i.text.includes(REVIEW_FENCE))?.id ??
      said[said.length - 1]?.id ??
      turnEndId,
  };
}

// Turns the analyst's reply into a card: a recommendation when it carries a
// valid block, an invalid one when it answered a digest without one.
export function recordReply(
  link: AnalystLink,
  reply: Reply
): Recommendation | null {
  const digest =
    !!reply.prompt?.id.startsWith(digestPrefix(link.id)) ||
    reply.prompt?.id === link.pendingDigestId;
  const parsed = parseReview(reply.text);
  if (!parsed.ok && !digest) return null;
  if (recommendationFor(link.id, reply.itemId)) return null;
  const about = {
    linkId: link.id,
    analystItemId: reply.itemId,
    coderThrough: link.pendingThrough ?? link.reviewedThrough,
    signals: link.digestSignals,
  };
  return parsed.ok
    ? insertRecommendation({
        ...about,
        verdict: parsed.review.verdict,
        summary: parsed.review.summary,
        issues: parsed.review.issues,
        prompt: parsed.review.prompt ?? null,
        state: "open",
      })
    : insertRecommendation({
        ...about,
        verdict: null,
        summary: "",
        issues: [],
        prompt: null,
        state: "invalid",
        error: parsed.error,
      });
}

// The analyst finished a turn: its review becomes a card, the digest it
// answered counts as reviewed, and turns that ended meanwhile go next.
export async function onAnalystTurnEnd(
  sessionId: string,
  turnEnd: Extract<ChatItem, { kind: "turn_end" }>
): Promise<void> {
  const link = liveLinkFor(sessionId);
  if (link?.analystSessionId !== sessionId) return;
  const reply = lastReply(sessionId, turnEnd.id);
  if (!reply) return;
  recordReply(link, reply);
  const answered = reply.prompt?.id;
  if (answered && answered === link.pendingDigestId)
    settleDigest(link.id, answered);
  if (getLink(link.id)?.pendingDigestId) return;
  await pushDigest(link.id);
}

// What the chat hook calls for every finished turn.
export async function onTurnEnd(
  sessionId: string,
  item: Extract<ChatItem, { kind: "turn_end" }>
): Promise<void> {
  const link = liveLinkFor(sessionId);
  if (!link) return;
  if (link.coderSessionId === sessionId) await onCoderTurnEnd(sessionId);
  else await onAnalystTurnEnd(sessionId, item);
}
