import type { ChatItem } from "./events";
import { eventParts, originOf } from "./origin";

export interface TranscriptPart {
  speaker: string;
  text: string;
}

// Who a message is from when copied, or null for rows that aren't part of the
// conversation itself (tools, turn markers, plans, approvals...).
export function speakerOf(item: ChatItem): string | null {
  switch (item.kind) {
    case "user": {
      const origin = originOf(item);
      if (!origin) return "User";
      return origin.kind === "decision" ? "Decision" : origin.label;
    }
    case "assistant":
      return "Assistant";
    case "error":
      return "Error";
    default:
      return null;
  }
}

// The whole message as written, for one a selection covers entirely.
export function sourceText(item: ChatItem): string {
  switch (item.kind) {
    case "user": {
      const origin = originOf(item);
      if (!origin) return item.text;
      const { body, decided } = eventParts(item, origin);
      return [...decided, body].join("\n\n");
    }
    case "assistant":
      return item.text;
    case "error":
      return item.message;
    default:
      return "";
  }
}

// `Speaker:` then the text, a blank line between messages. Neighbours from
// the same speaker (a reply split around its tools) read as one message.
export function formatTranscript(parts: TranscriptPart[]): string {
  const merged: TranscriptPart[] = [];
  for (const p of parts) {
    const text = p.text.trim();
    if (!text) continue;
    const last = merged.at(-1);
    if (last && last.speaker === p.speaker)
      last.text = `${last.text}\n\n${text}`;
    else merged.push({ speaker: p.speaker, text });
  }
  return merged.map((p) => `${p.speaker}:\n${p.text}`).join("\n\n");
}
