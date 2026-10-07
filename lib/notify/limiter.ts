// At most one phone notification a minute from each source. A message
// inside that minute waits in the outbox (SQLite, so a restart doesn't lose
// it) and goes out with any others as one; the same text twice in a minute
// goes once. Each row is marked sent before it's sent: a crash mid-send
// loses that one message rather than sending it twice.

import { db } from "../db";
import { MAX_TEXT } from "./notifiers";

export const WINDOW_MS = 60_000;
// Held per source before more are dropped.
export const MAX_HELD = 20;

export type Outcome =
  | { state: "sent" }
  | { state: "held"; inMs: number }
  | { state: "duplicate" }
  | { state: "dropped" }
  | { state: "failed"; why: string };

export function collapse(texts: string[]): string {
  if (texts.length === 1) return texts[0];
  return `${texts.length} updates:\n${texts.map((t) => `• ${t}`).join("\n")}`;
}

const clip = (text: string) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;

type Row = { id: number; text: string; send_after: number };

export class Limiter {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private send: (text: string) => Promise<void>,
    private opts: {
      now?: () => number;
      windowMs?: number;
      onLate?: (source: string, error: unknown) => void;
    } = {}
  ) {}

  private get now() {
    return this.opts.now?.() ?? Date.now();
  }
  private get windowMs() {
    return this.opts.windowMs ?? WINDOW_MS;
  }

  private lastSent(source: string): number | null {
    const row = db
      .prepare(
        `SELECT MAX(sent_at) AS at FROM notify_outbox WHERE source = ? AND sent_at IS NOT NULL`
      )
      .get(source) as { at: number | null };
    return row.at;
  }

  private held(source: string): Row[] {
    return db
      .prepare(
        `SELECT id, text, send_after FROM notify_outbox WHERE source = ? AND sent_at IS NULL ORDER BY id`
      )
      .all(source) as Row[];
  }

  async push(source: string, raw: string): Promise<Outcome> {
    const text = clip(raw);
    const now = this.now;
    const last = this.lastSent(source);
    const recent = last !== null && now - last < this.windowMs;
    const held = this.held(source);
    const dup = db
      .prepare(
        `SELECT 1 FROM notify_outbox WHERE source = ? AND text = ?
           AND (sent_at IS NULL OR sent_at > ?)`
      )
      .get(source, text, now - this.windowMs);
    if (dup) return { state: "duplicate" };
    if (recent || held.length) {
      if (held.length >= MAX_HELD) return { state: "dropped" };
      const at = (last ?? now) + this.windowMs;
      db.prepare(
        `INSERT INTO notify_outbox (source, text, created_at, send_after) VALUES (?, ?, ?, ?)`
      ).run(source, text, now, at);
      this.arm(source, at);
      return { state: "held", inMs: Math.max(0, at - now) };
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO notify_outbox (source, text, created_at, send_after, sent_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(source, text, now, now, now);
    try {
      await this.send(text);
      return { state: "sent" };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      db.prepare(`UPDATE notify_outbox SET error = ? WHERE id = ?`).run(
        why.slice(0, 500),
        lastInsertRowid
      );
      return { state: "failed", why };
    }
  }

  private arm(source: string, at: number): void {
    if (this.timers.has(source)) return;
    // A database error here must not become an unhandled rejection: the
    // rows stay unsent and the next push or start re-arms them.
    const timer = setTimeout(
      () => {
        this.flush(source).catch((error) => this.opts.onLate?.(source, error));
      },
      Math.max(0, at - this.now)
    );
    timer.unref?.();
    this.timers.set(source, timer);
  }

  // Sends what waited, as one message.
  async flush(source: string): Promise<void> {
    const timer = this.timers.get(source);
    if (timer) clearTimeout(timer);
    this.timers.delete(source);
    const rows = this.held(source);
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => "?").join(",");
    db.prepare(
      `UPDATE notify_outbox SET sent_at = ? WHERE id IN (${marks}) AND sent_at IS NULL`
    ).run(this.now, ...ids);
    try {
      await this.send(collapse(rows.map((r) => r.text)));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      db.prepare(
        `UPDATE notify_outbox SET error = ? WHERE id IN (${marks})`
      ).run(why.slice(0, 500), ...ids);
      this.opts.onLate?.(source, error);
    }
  }

  // After a restart: re-arm every source with messages still waiting.
  resume(): void {
    const rows = db
      .prepare(
        `SELECT source, MIN(send_after) AS at FROM notify_outbox WHERE sent_at IS NULL GROUP BY source`
      )
      .all() as { source: string; at: number }[];
    for (const r of rows) this.arm(r.source, r.at);
  }
}
