/**
 * The text a bookmark keeps of what it marks: readable, clipped, and with
 * secrets masked so a key in a tool's output doesn't sit in a second table.
 */

import type { ChatItem } from "../chat/events";
import { toRaw } from "../share/snapshot";
import { NO_CONTEXT, redactForShare } from "../share/redact";
import { envSecrets } from "../share/context";

export const MAX_SNAPSHOT_CHARS = 4_000;

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
  const clipped =
    text.length > MAX_SNAPSHOT_CHARS
      ? text.slice(0, MAX_SNAPSHOT_CHARS) + "…"
      : text;
  return redactForShare(clipped, { ...NO_CONTEXT, secrets: envSecrets() }).text;
}
