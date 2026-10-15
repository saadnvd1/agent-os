/**
 * Push for the phone app. `pushEvent` decides whether an event goes out, to
 * whom, and now or in the Away digest; the sender does the delivering.
 * Telegram is the fallback only for what Telegram carried before push
 * (events given a `fallback`); the newer events are push-only.
 */

import crypto from "crypto";
import { db } from "../../db";
import { activeAway } from "../../away/state";
import { listPushDevices } from "@/lib/security/devices";
import type { PushEvent } from "../push-types";
import { encodePush } from "./encode";
import * as outbox from "./outbox";
import { atMac } from "./presence";
import {
  CAP_PER_HOUR,
  HOUR_MS,
  capExempt,
  foldsWhenAway,
  presenceGated,
} from "./policy";
import { linked, NOT_LINKED } from "./relay";
import { PushSender } from "./sender";

const g = globalThis as unknown as { __agentosPush?: PushSender };

export function sender(): PushSender {
  return (g.__agentosPush ??= new PushSender());
}

/** Whether a message with a push category can go by push right now. */
export function pushAvailable(): boolean {
  return linked() && !sender().unavailable() && listPushDevices().length > 0;
}

export function pushStatus(): { linked: boolean; unavailable: string | null } {
  return { linked: linked(), unavailable: sender().unavailable() };
}

export type PushOutcome =
  | "queued"
  | "folded"
  | "dropped"
  | "muted"
  | "unavailable";

export interface PushOptions {
  /** Held text that goes by Telegram if no phone is reached. */
  fallback?: { source: string; text: string } | null;
  /** A session the event is about: a mirror of another machine's never pushes. */
  sessionId?: string | null;
  /** Explicit sends (a test): no presence, Away, cap or category rules. */
  bypass?: boolean;
  deviceIds?: string[];
}

function isMirrored(sessionId: string): boolean {
  const s = db
    .prepare(`SELECT host_id, peer_mirror FROM session_rows WHERE id = ?`)
    .get(sessionId) as
    | { host_id: string | null; peer_mirror: number | null }
    | undefined;
  return !!s && (!!s.peer_mirror || (!!s.host_id && s.host_id !== "local"));
}

export async function pushEvent(
  event: PushEvent,
  opts: PushOptions = {}
): Promise<PushOutcome> {
  if (opts.sessionId && isMirrored(opts.sessionId)) return "dropped";
  const s = sender();
  if (!linked() || s.unavailable()) return "unavailable";
  const devices = listPushDevices().filter(
    (d) => !opts.deviceIds || opts.deviceIds.includes(d.id)
  );
  if (!devices.length) return "unavailable";
  const targets = opts.bypass
    ? devices
    : devices.filter((d) => d.push.categories.includes(event.category));
  if (!targets.length) return "muted";

  const now = Date.now();
  const key = event.key ?? `${event.category}:${event.id ?? "-"}:${now}`;
  const enc = encodePush({ ...event, key });
  const row = {
    eventKey: key,
    category: event.category,
    level: enc.level,
    payload: enc.payload,
    collapseId: enc.collapseId,
    now,
  };
  if (!opts.bypass) {
    if (activeAway() && foldsWhenAway(event.category)) {
      outbox.enqueue({ ...row, deviceId: "", state: "folded" });
      return "folded";
    }
    if (presenceGated(event.category) && (await atMac())) return "dropped";
  }
  let queued = 0;
  for (const d of targets) {
    const over =
      !opts.bypass &&
      !capExempt(event.category) &&
      enc.level !== "passive" &&
      outbox.alertingSince(d.id, now) >= CAP_PER_HOUR;
    if (over) {
      outbox.enqueue({ ...row, deviceId: d.id, state: "capped" });
      // One summary an hour says there was more.
      const sum = encodePush({
        category: "digest",
        key: `overflow:${d.id}:${Math.floor(now / HOUR_MS)}`,
      });
      outbox.enqueue({
        eventKey: `overflow:${d.id}:${Math.floor(now / HOUR_MS)}`,
        deviceId: d.id,
        category: "digest",
        level: sum.level,
        payload: sum.payload,
        collapseId: sum.collapseId,
        now,
      });
      queued++;
      continue;
    }
    if (outbox.enqueue({ ...row, deviceId: d.id, fallback: opts.fallback }))
      queued++;
  }
  if (queued) void s.kick();
  return queued ? "queued" : "dropped";
}

export interface TestResult {
  deviceId: string;
  status: "sent" | "gone" | "failed";
  error: string | null;
}

/** A real send to the phones now, ignoring every quiet rule, and its answer. */
export async function sendTestPush(
  deviceId?: string
): Promise<{ results: TestResult[]; unavailable: string | null }> {
  const s = sender();
  if (!linked()) return { results: [], unavailable: NOT_LINKED };
  s.clearUnavailable();
  const key = `test:${Date.now()}:${crypto.randomBytes(3).toString("hex")}`;
  const devices = listPushDevices().filter(
    (d) => !deviceId || d.id === deviceId
  );
  const enc = encodePush({ category: "system", key });
  const now = Date.now();
  for (const d of devices)
    outbox.enqueue({
      eventKey: key,
      deviceId: d.id,
      category: "system",
      level: enc.level,
      payload: enc.payload,
      collapseId: enc.collapseId,
      now,
    });
  await s.kick();
  const results = outbox.rowsFor(key).map((r) => ({
    deviceId: r.device_id,
    status: (r.state === "sent"
      ? "sent"
      : r.state === "gone"
        ? "gone"
        : "failed") as TestResult["status"],
    error: r.state === "sent" ? null : (r.error ?? "not sent"),
  }));
  return { results, unavailable: s.unavailable() };
}

export function resumePushOutbox(): void {
  sender().resume();
}

/** How many held events the next Away digest stands for. */
export function takeFoldedPushes(now = Date.now()): number {
  return outbox.takeFolded(now);
}
