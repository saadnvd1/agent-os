/**
 * The text a bookmark keeps of what it marks: readable, clipped, and with
 * secrets masked so a key in a tool's output doesn't sit in a second table.
 */

import type { ChatItem } from "../chat/events";
import { toRaw } from "../share/snapshot";
import { NO_CONTEXT, redactForShare } from "../share/redact";
import { envSecrets } from "../share/context";
import { MAX_SNAPSHOT_CHARS } from "./types";

function plain(item: ChatItem): string {
  const raw = toRaw(item);
  if (!raw) return "";
  return raw.label ? `${raw.label}\n${raw.text}` : raw.text;
}

// A turn reads as what was asked and the start of the answer.
export function snapshotText(item: ChatItem, reply?: ChatItem): string {
  const text = [plain(item), reply ? plain(reply) : ""]
    .filter((t) => t.trim())
    .join("\n\n")
    .trim();
  // Redacted before the cut, so a secret the cut splits is still caught; the
  // wide first cut only bounds the work on a huge tool output.
  const safe = redactForShare(text.slice(0, MAX_SNAPSHOT_CHARS * 4), {
    ...NO_CONTEXT,
    secrets: envSecrets(),
  }).text;
  return safe.length > MAX_SNAPSHOT_CHARS
    ? safe.slice(0, MAX_SNAPSHOT_CHARS) + "…"
    : safe;
}
