/**
 * What goes up to Connect for one chat item, or nothing. Which items a
 * guest may see is decided by the shared snapshot rules (toRaw); this only
 * shapes them into frames. Text is redacted whole, never as a delta.
 */

import type { ChatItem, ChatState } from "../chat/events";
import { isSecretPath } from "../secret-paths";
import { toRaw, strings } from "../share/snapshot";
import { redactForShare, type ShareContext } from "./../share/redact";

export type ItemFrame =
  | {
      id: string;
      kind: "user" | "assistant" | "note";
      text: string;
      from?: string;
      at: number;
    }
  | {
      id: string;
      kind: "tool";
      name: string;
      summary: string;
      status: "running" | "done" | "error";
      at: number;
    };

export type LiveState = "working" | "idle" | "waiting_on_host";

export const MAX_TEXT_BYTES = 24 * 1024;
export const MAX_SUMMARY_BYTES = 200;
const MAX_NAME_BYTES = 64;
const MAX_ID = 64;

/** The longest prefix of `s` that fits in `max` bytes, cut on a character. */
export function clipBytes(s: string, max: number): string {
  if (Buffer.byteLength(s) <= max) return s;
  let out = "";
  let size = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch);
    if (size + n > max) break;
    out += ch;
    size += n;
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function stateOf(state: ChatState): LiveState {
  if (state === "running") return "working";
  if (state === "waiting") return "waiting_on_host";
  return "idle";
}

// Messages that were not typed by the reader (the agent bus, schedules,
// AgentOS itself) stay on this machine; a sent suggestion is the reader's.
function userFrom(item: Extract<ChatItem, { kind: "user" }>): string | null {
  const o = item.origin;
  if (!o) return item.peer || item.from ? null : "host";
  if (o.kind === "guest") return `guest:${o.label}`;
  if (o.kind === "decision") return "host";
  return null;
}

export interface ItemMapper {
  /** `text` replaces the item's own text (an assistant turn still streaming). */
  (item: ChatItem, text?: string): ItemFrame | null;
}

export function itemMapper(ctx: ShareContext): ItemMapper {
  const take = (s: string) => redactForShare(s, ctx).text;
  return (item, text) => {
    const at = item.createdAt ?? Date.now();
    const id = item.id.slice(0, MAX_ID);
    if (item.kind === "tool") {
      const secret = strings(item.input).some(isSecretPath);
      const label = secret ? item.name : item.title || item.name;
      const status =
        item.status === "running"
          ? "running"
          : item.status === "done"
            ? "done"
            : "error";
      return {
        id,
        kind: "tool",
        name: clipBytes(oneLine(take(item.name)), MAX_NAME_BYTES),
        summary: clipBytes(oneLine(take(label)), MAX_SUMMARY_BYTES),
        status,
        at,
      };
    }
    if (item.kind === "todos") {
      const done = item.todos.filter((t) => t.status === "completed").length;
      return {
        id,
        kind: "note",
        text: `To do: ${done} of ${item.todos.length} done`,
        at,
      };
    }
    let from: string | undefined;
    if (item.kind === "user") {
      const f = userFrom(item);
      if (!f) return null;
      from = f;
    }
    const raw = toRaw(item);
    if (!raw || raw.tools || raw.type === "artifact") return null;
    const body = clipBytes(take(text ?? raw.text), MAX_TEXT_BYTES);
    if (item.kind === "user")
      return {
        id,
        kind: "user",
        text: body,
        from,
        at,
      };
    if (item.kind === "assistant")
      return body.trim() ? { id, kind: "assistant", text: body, at } : null;
    // Plans, errors and the compaction divider are one-line notes.
    return {
      id,
      kind: "note",
      text: clipBytes(oneLine(body), 400) || "…",
      at,
    };
  };
}
