/**
 * The one place an event becomes the bytes the relay is given. v1 is the
 * generic, content-free envelope. Encrypted rich text (v2) replaces the body
 * of this function and nothing else: callers hand over an event, never a
 * payload.
 */

import crypto from "crypto";
import { buildPushPayload, isGenericPayload } from "../copy";
import type { PushEnvelope, PushEvent, PushLevel } from "../push-types";

export interface EncodedPush {
  payload: PushEnvelope;
  level: PushLevel;
  priority: 10 | 5;
  /** Opaque: a hash, so the relay and Apple learn nothing from it. */
  collapseId: string;
  threadId: string;
}

/** Same event key, same id, on every machine that sends it. */
export const collapseId = (key: string) =>
  crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);

export function encodePush(
  event: PushEvent,
  _device?: { id: string }
): EncodedPush {
  const payload = buildPushPayload({ ...event, key: null });
  // Nothing but what the registry could have built may leave the machine.
  if (!isGenericPayload(payload))
    throw new Error(
      "refusing to send a push payload the registry didn't build"
    );
  return {
    payload,
    level: payload.p,
    priority: payload.p === "passive" ? 5 : 10,
    collapseId: collapseId(event.collapse ?? event.key ?? payload.k),
    threadId: event.category,
  };
}
