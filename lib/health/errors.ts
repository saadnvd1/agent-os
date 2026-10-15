/**
 * Server errors, counted. console.error calls go into ten-minute
 * buckets (a day of them is the baseline), and the last lines
 * are kept, redacted, for a watcher that asks to see them.
 */

import { redact } from "../models/secrets";
import { MIN } from "./types";

const BUCKET_MS = 10 * MIN;
const BUCKETS = 144;
const KEEP_LINES = 200;
// Fewer full buckets than this is too little to call a baseline.
const MIN_HISTORY = 6;

const buckets = new Map<number, number>();
const lines: { at: number; text: string }[] = [];
let installed = false;

const bucketOf = (t: number) => Math.floor(t / BUCKET_MS);

export function countError(text: string, now = Date.now()): void {
  const b = bucketOf(now);
  buckets.set(b, (buckets.get(b) ?? 0) + 1);
  for (const k of buckets.keys()) if (k <= b - BUCKETS) buckets.delete(k);
  lines.push({ at: now, text: redact(text).slice(0, 400) });
  if (lines.length > KEEP_LINES) lines.splice(0, lines.length - KEEP_LINES);
}

// Errors in the current and previous bucket, so "the last 10 minutes" never
// reads as zero right after a bucket turns over; and the mean per bucket
// before those.
export function errorRate(now = Date.now()): {
  recent: number;
  baselineMean: number;
} {
  const b = bucketOf(now);
  const recent = (buckets.get(b) ?? 0) + (buckets.get(b - 1) ?? 0);
  const before = [...buckets.entries()].filter(([k]) => k < b - 1);
  if (before.length < MIN_HISTORY) return { recent, baselineMean: 0 };
  const sum = before.reduce((n, [, v]) => n + v, 0);
  // Buckets with no errors aren't stored: the mean is over the whole span.
  const span = BUCKETS - 2;
  return { recent, baselineMean: sum / span };
}

export const recentErrorLines = (max = 30, since = Date.now() - 60 * MIN) =>
  lines
    .filter((l) => l.at >= since)
    .slice(-max)
    .map((l) => l.text);

export function resetErrors(): void {
  buckets.clear();
  lines.length = 0;
}

function text(args: unknown[]): string {
  return args
    .map((a) =>
      a instanceof Error
        ? (a.stack ?? a.message)
        : typeof a === "string"
          ? a
          : safeJson(a)
    )
    .join(" ");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function installErrorCounter(): void {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      countError(text(args));
    } catch {
      // Counting must never break logging.
    }
    original(...args);
  };
}
