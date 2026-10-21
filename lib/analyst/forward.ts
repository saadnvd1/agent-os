import { sendChat } from "../chat/runner";
import { ASK_AGAIN } from "./brief";
import { digestPrefix } from "./pushDigest";
import {
  decideRecommendation,
  getLink,
  getRecommendation,
  markDigestPending,
  reopenRecommendation,
} from "./store";
import { AnalystError, type AnalystLink, type Recommendation } from "./types";

// A prompt into the coding agent's chat as the reader's decision, by id,
// so a repeat is a no-op. It waits in the queue while a turn runs.
export async function forwardToCoder(
  coderSessionId: string,
  input: { text: string; id: string; label: string; fromSessionId: string }
): Promise<void> {
  await sendChat(coderSessionId, {
    text: input.text,
    id: input.id,
    queue: true,
    origin: {
      kind: "decision",
      label: input.label,
      sessionId: input.fromSessionId,
    },
  });
}

function liveLink(linkId: string): AnalystLink {
  const link = getLink(linkId);
  if (!link) throw new AnalystError("Pairing not found", 404);
  if (link.endedAt) throw new AnalystError("This pairing has ended", 409);
  return link;
}

function cardOf(link: AnalystLink, recId: string): Recommendation {
  const rec = getRecommendation(recId);
  if (!rec || rec.linkId !== link.id)
    throw new AnalystError("Recommendation not found", 404);
  return rec;
}

export const sentItemId = (recId: string) => `user-analyst-rec-${recId}`;

// Send to Coding Agent: the analyst's prompt, or the reader's edit of it.
export async function sendRecommendation(
  linkId: string,
  recId: string,
  edited?: string
): Promise<Recommendation> {
  const link = liveLink(linkId);
  const rec = cardOf(link, recId);
  const text = (edited ?? rec.prompt ?? "").trim();
  if (!text) throw new AnalystError("There is no prompt to send", 400);
  const id = sentItemId(rec.id);
  const isEdit = edited !== undefined && edited.trim() !== rec.prompt?.trim();
  // Claimed first, so two presses send once.
  if (
    !decideRecommendation(rec.id, "sent", { text, itemId: id, edited: isEdit })
  )
    throw new AnalystError(`This recommendation was already ${rec.state}`, 409);
  try {
    await forwardToCoder(link.coderSessionId, {
      text,
      id,
      label: "Analyst",
      fromSessionId: link.analystSessionId,
    });
  } catch (error) {
    reopenRecommendation(rec.id);
    throw error;
  }
  return getRecommendation(rec.id)!;
}

export function dismissRecommendation(
  linkId: string,
  recId: string
): Recommendation {
  const link = liveLink(linkId);
  const rec = cardOf(link, recId);
  if (!decideRecommendation(rec.id, "dismissed"))
    throw new AnalystError(`This recommendation was already ${rec.state}`, 409);
  return getRecommendation(rec.id)!;
}

// Ask again, on a card whose reply had no valid block: the analyst gets a
// short correction, answered like the digest it replaces.
export async function askAgain(linkId: string, recId: string): Promise<void> {
  const link = liveLink(linkId);
  const rec = cardOf(link, recId);
  if (rec.state !== "invalid")
    throw new AnalystError(
      "Only a reply with no recommendation is asked again",
      409
    );
  const id = `${digestPrefix(link.id)}again-${rec.id}`;
  const through = rec.coderThrough ?? link.reviewedThrough;
  if (through && link.digestSignals)
    markDigestPending(link.id, id, through, link.digestSignals);
  await sendChat(link.analystSessionId, {
    text: ASK_AGAIN,
    id,
    queue: true,
    origin: { kind: "system", label: "AgentOS" },
  });
}
