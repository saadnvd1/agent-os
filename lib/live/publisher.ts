/**
 * Chat messages of a live session, as frames for Connect. Registered as a tap
 * beside emit() in the chat registry, only for sessions with a live share.
 * An assistant turn is redacted whole and sent at most once a second.
 */

import type { ChatItem, ChatServerMessage } from "../chat/events";
import { listItems } from "../chat/store";
import { visible } from "../share/snapshot";
import { stateOf } from "./frames";
import { live, type Runtime } from "./runtime";

const FLUSH_MS = 1000;
const SLOW_FLUSH_MS = 4000;

export function seed(rt: Runtime, sessionId: string): void {
  for (const item of visible(listItems(sessionId))) {
    const frame = rt.map(item);
    if (frame) rt.ring.upsert(frame);
  }
}

export function flush(rt: Runtime): void {
  if (rt.flushTimer) clearTimeout(rt.flushTimer);
  rt.flushTimer = null;
  const batch = [...rt.dirty.values()];
  rt.dirty.clear();
  for (const { item, text } of batch) {
    // A word still being typed is held back: half a key isn't recognisable.
    const open = text !== undefined && rt.streaming.has(item.id);
    const frame = rt.map(item, open ? text.replace(/\S+$/, "") : text);
    if (!frame) continue;
    rt.ring.upsert(frame);
    live.socket?.send(rt.share.id, "item", frame);
  }
}

function schedule(rt: Runtime, now: boolean) {
  if (now) return flush(rt);
  if (rt.flushTimer) return;
  rt.flushTimer = setTimeout(
    () => flush(rt),
    Date.now() < rt.slowUntil ? SLOW_FLUSH_MS : FLUSH_MS
  );
}

function mark(rt: Runtime, item: ChatItem, text?: string) {
  rt.dirty.set(item.id, { item, text });
}

export function onMessage(sessionId: string, m: ChatServerMessage): void {
  for (const rt of live.runtimes.values()) {
    if (rt.share.session_id !== sessionId || rt.share.ended_at) continue;
    if (m.type === "state") {
      live.socket?.send(rt.share.id, "state", { state: stateOf(m.state) });
    } else if (m.type === "item") {
      const item = m.item;
      if (item.kind === "turn_end") {
        flush(rt);
        live.socket?.send(rt.share.id, "state", { state: "idle" });
        continue;
      }
      const streaming =
        (item.kind === "assistant" || item.kind === "reasoning") &&
        item.streaming === true;
      if (item.kind === "assistant") {
        if (streaming) rt.streaming.set(item.id, { item, text: item.text });
        else rt.streaming.delete(item.id);
      }
      mark(
        rt,
        item,
        item.kind === "assistant" && streaming ? item.text : undefined
      );
      schedule(rt, !streaming);
    } else if (m.type === "delta") {
      const cur = rt.streaming.get(m.id);
      if (!cur) continue;
      cur.text += m.text;
      mark(rt, cur.item, cur.text);
      schedule(rt, false);
    }
  }
}
