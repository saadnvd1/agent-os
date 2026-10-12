/**
 * Drains the push outbox into the Connect relay. Never throws at a caller and
 * never blocks one: `kick()` starts a drain and returns. Retries back off;
 * a relay that says push isn't set up is left alone for ten minutes instead
 * of being asked per message, and what was waiting falls back to Telegram.
 */

import type { PushRequestBody } from "@/lib/connect/control-api";
import {
  getDevicePush,
  pruneDevicePush,
  setDevicePushError,
} from "@/lib/security/devices";
import * as outbox from "./outbox";
import { relaySend, type RelayAnswer } from "./relay";
import { isTestKey, type OutboxRow } from "./outbox";

export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [30_000, 120_000];
const MAX_BACKOFF_MS = 600_000;
export const UNAVAILABLE_MS = 600_000;
const BATCH = 10;
/** Dead tokens are hex; anything else would make the relay refuse the batch. */
const APNS_TOKEN = /^[0-9a-fA-F]{64,200}$/;

export interface SenderDeps {
  now: () => number;
  relay: (body: PushRequestBody) => Promise<RelayAnswer>;
  /** Sends a held message by the other channel. */
  fallback: (source: string, text: string) => Promise<void>;
  log: (line: string) => void;
}

type Sink = SenderDeps["fallback"];
// On globalThis like the sender: the app's bundles each have their own copy
// of this module, and the one that sets the sink may not be the one that built
// the sender.
const sinks = globalThis as unknown as { __agentosPushFallback?: Sink };

/** Where held text goes when push can't deliver it (Telegram). */
export function setFallbackSink(fn: Sink): void {
  sinks.__agentosPushFallback = fn;
}

const defaults = (): SenderDeps => ({
  now: () => Date.now(),
  relay: relaySend,
  fallback: async (source, text) => sinks.__agentosPushFallback?.(source, text),
  log: (line) => console.error(`[push] ${line}`),
});

export class PushSender {
  private deps: SenderDeps;
  private running = false;
  private again = false;
  private current: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private down: { until: number; reason: string } | null = null;

  constructor(deps: Partial<SenderDeps> = {}) {
    this.deps = { ...defaults(), ...deps };
  }

  /** Why pushes aren't being tried right now, or null. */
  unavailable(): string | null {
    if (this.down && this.deps.now() >= this.down.until) this.down = null;
    return this.down?.reason ?? null;
  }

  clearUnavailable(): void {
    this.down = null;
  }

  /** Stops the retry timer (a test discarding its sender). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Starts a drain if none is running; resolves when it has caught up. */
  kick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.current;
    }
    this.running = true;
    this.current = this.drain().finally(() => {
      this.running = false;
      this.arm();
    });
    return this.current;
  }

  /** Re-arms after a restart. */
  resume(): void {
    outbox.resume(this.deps.now());
    void this.kick();
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.again = false;
        for (const key of outbox.expire(this.deps.now()))
          await this.settle(key);
        for (;;) {
          const rows = outbox.claimDue(this.deps.now());
          if (!rows.length) break;
          const byEvent = new Map<string, OutboxRow[]>();
          for (const r of rows)
            byEvent.set(r.event_key, [...(byEvent.get(r.event_key) ?? []), r]);
          for (const group of byEvent.values())
            for (let i = 0; i < group.length; i += BATCH)
              await this.sendGroup(group.slice(i, i + BATCH));
        }
      } while (this.again);
    } catch (error) {
      this.deps.log(
        `drain failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const at = outbox.nextDueAt();
    if (at === null) return;
    this.timer = setTimeout(
      () => void this.kick(),
      Math.max(1000, at - this.deps.now())
    );
    this.timer.unref?.();
  }

  private async sendGroup(rows: OutboxRow[]): Promise<void> {
    // An earlier group in this drain found the relay unusable.
    const down = this.unavailable();
    if (down) {
      for (const r of rows) outbox.markFailed(r.id, down);
      for (const key of new Set(rows.map((r) => r.event_key)))
        await this.settle(key);
      return;
    }
    const sendable: {
      row: OutboxRow;
      token: string;
      env: "production" | "sandbox";
    }[] = [];
    for (const row of rows) {
      const push = getDevicePush(row.device_id);
      if (!push) outbox.markFailed(row.id, "no push token", true);
      else if (!APNS_TOKEN.test(push.token)) {
        outbox.markFailed(row.id, "not an APNs token");
        setDevicePushError(
          row.device_id,
          "the registered token isn't an APNs token"
        );
      } else sendable.push({ row, token: push.token, env: push.environment });
    }
    // The relay folds a repeated token into one result, so send each once.
    const seen = new Set<string>();
    const unique = sendable.filter((s) => {
      const k = `${s.token.toLowerCase()}:${s.env}`;
      if (seen.has(k)) {
        outbox.markFailed(s.row.id, "duplicate token");
        return false;
      }
      seen.add(k);
      return true;
    });
    if (unique.length) {
      const first = unique[0].row;
      const answer = await this.deps.relay({
        v: 1,
        devices: unique.map((s) => ({ token: s.token, env: s.env })),
        push_type: "alert",
        priority: first.level === "passive" ? 5 : 10,
        level: first.level,
        ...(first.collapse_id && { collapse_id: first.collapse_id }),
        thread_id: first.category,
        payload: JSON.parse(first.payload),
      });
      await this.apply(
        unique.map((s) => s.row),
        answer
      );
    }
    for (const key of new Set(rows.map((r) => r.event_key)))
      await this.settle(key);
  }

  private async apply(rows: OutboxRow[], answer: RelayAnswer): Promise<void> {
    const now = this.deps.now();
    if (answer.kind === "unavailable") {
      this.down = { until: now + UNAVAILABLE_MS, reason: answer.reason };
      this.deps.log(`push unavailable: ${answer.reason}`);
      for (const r of rows) {
        outbox.markFailed(r.id, answer.reason);
        setDevicePushError(r.device_id, answer.reason);
      }
      for (const key of outbox.failPending(answer.reason))
        await this.settle(key);
      return;
    }
    if (answer.kind === "invalid") {
      for (const r of rows) {
        outbox.markFailed(r.id, answer.reason);
        setDevicePushError(r.device_id, answer.reason);
      }
      return;
    }
    rows.forEach((r, i) => {
      if (answer.kind === "retry")
        return this.retry(r, now, answer.reason, answer.afterMs);
      const res = answer.results[i];
      if (!res) return this.retry(r, now, "no answer for this device");
      if (res.status === "sent") {
        outbox.markSent(r.id, now);
        setDevicePushError(r.device_id, null);
      } else if (res.status === "gone" || res.prune) {
        const why = `token no longer valid${res.reason ? ` (${res.reason})` : ""}`;
        pruneDevicePush(r.device_id, why);
        outbox.markFailed(r.id, why, true);
      } else if (res.status === "retry") {
        this.retry(
          r,
          now,
          res.reason ?? "try again",
          res.retry_after ? res.retry_after * 1000 : undefined
        );
      } else {
        const why = res.reason ?? "rejected";
        outbox.markFailed(r.id, why);
        setDevicePushError(r.device_id, why);
      }
    });
  }

  private retry(
    r: OutboxRow,
    now: number,
    why: string,
    afterMs?: number
  ): void {
    const max = isTestKey(r.event_key) ? 1 : MAX_ATTEMPTS;
    if (r.attempts >= max) {
      outbox.markFailed(r.id, why);
      setDevicePushError(r.device_id, why);
      return;
    }
    const wait = Math.min(
      Math.max(BACKOFF_MS[r.attempts - 1] ?? BACKOFF_MS.at(-1)!, afterMs ?? 0),
      MAX_BACKOFF_MS
    );
    outbox.markRetry(r.id, now + wait, why);
  }

  /** Once an event has ended with no phone reached, the held text goes by Telegram. */
  private async settle(eventKey: string): Promise<void> {
    const held = outbox.claimFallback(eventKey);
    if (!held) return;
    try {
      await this.deps.fallback(held.source, held.text);
    } catch (error) {
      this.deps.log(
        `fallback for ${held.source} didn't send: ${error instanceof Error ? error.message : error}`
      );
    }
  }
}
