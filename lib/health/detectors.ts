/**
 * The checks. Each is a pure function of one snapshot (facts.ts) and the
 * thresholds (config.ts): no I/O, no model, no tokens. A check that finds
 * something returns a Trip; store.ts decides whether that's news.
 */

import type { HealthConfig } from "./config";
import { duration } from "./view";
import {
  MIN,
  type BgFact,
  type HealthFacts,
  type Severity,
  type Trip,
} from "./types";

export { duration };

const trip = (
  t: Omit<Trip, "workspaceId" | "detail"> &
    Partial<Pick<Trip, "workspaceId" | "detail">>
): Trip => ({ workspaceId: null, detail: {}, ...t });

// More than this many times the threshold reads as high.
const HIGH_AFTER = 3;
const severityOf = (age: number, limit: number): Severity =>
  limit > 0 && age >= limit * HIGH_AFTER ? "high" : "warn";

export function loadRed(f: HealthFacts, c: HealthConfig): Trip[] {
  const limit = c.loadRedMinutes * MIN;
  return f.machines
    .filter((m) => m.redSince !== null && f.now - m.redSince >= limit)
    .map((m) => {
      const age = f.now - (m.redSince as number);
      return trip({
        check: "load-red",
        subject: m.id,
        severity: severityOf(age, limit),
        line: `${m.label} load has been red for ${duration(age)}.`,
        detail: { load1: m.load1 ?? null, cores: m.cores ?? null },
      });
    });
}

export function queueHeld(f: HealthFacts, c: HealthConfig): Trip[] {
  const limit = c.queueHeldMinutes * MIN;
  return f.queue
    .filter((q) => f.now - q.createdAt >= limit)
    .map((q) => {
      const age = f.now - q.createdAt;
      return trip({
        check: "queue-held",
        subject: q.id,
        severity: severityOf(age, limit),
        line: `Queued task "${q.name ?? q.id}" has been held ${duration(age)}: ${q.heldBy}.`,
        workspaceId: q.workspaceId,
        detail: { heldBy: q.heldBy },
      });
    });
}

const bgLine = (b: BgFact, quietMs: number) =>
  b.outputAt === null
    ? `Background job "${b.description}" in ${b.sessionName} has printed nothing in ${duration(quietMs)}.`
    : `Background job "${b.description}" in ${b.sessionName} has been quiet ${duration(quietMs)}.`;

export function bgQuiet(f: HealthFacts, c: HealthConfig): Trip[] {
  const limit = c.bgQuietMinutes * MIN;
  return f.bg
    .map((b) => ({ b, quietMs: f.now - (b.outputAt ?? b.startedAt) }))
    .filter(({ quietMs }) => quietMs >= limit)
    .map(({ b, quietMs }) =>
      trip({
        check: "bg-quiet",
        subject: `${b.sessionId}:${b.taskId}`,
        severity: severityOf(quietMs, limit),
        line: bgLine(b, quietMs),
        workspaceId: b.workspaceId,
        detail: {
          sessionId: b.sessionId,
          taskId: b.taskId,
          neverPrinted: b.outputAt === null,
        },
      })
    );
}

export function restarts(f: HealthFacts, c: HealthConfig): Trip[] {
  const recent = f.boots.filter(
    (t) => f.now - t <= c.restartsWindowMinutes * MIN
  );
  if (recent.length <= c.restartsMax) return [];
  const deploys = f.deploys.length;
  return [
    trip({
      check: "restarts",
      subject: "server",
      severity: "high",
      line: `AgentOS restarted ${recent.length} times in the last ${c.restartsWindowMinutes} minutes${deploys ? ` (besides ${deploys} autodeploy ${deploys === 1 ? "restart" : "restarts"})` : ""}.`,
      detail: { boots: recent },
    }),
  ];
}

// The oldest a CI run may be and still be usual: twice the median, or the
// slowest tenth plus five minutes, whichever is longer. With too little
// history, the fallback.
export function ciLimit(baseline: number[], fallbackMs: number): number {
  if (baseline.length < 5) return fallbackMs;
  const sorted = [...baseline].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return Math.max(2 * at(0.5), at(0.9) + 5 * MIN);
}

export function ciSlow(f: HealthFacts, c: HealthConfig): Trip[] {
  return f.ci
    .map((r) => ({
      r,
      limit: ciLimit(r.baseline, c.ciSlowFallbackMinutes * MIN),
    }))
    .filter(({ r, limit }) => f.now - r.pendingSince > limit)
    .map(({ r, limit }) => {
      const age = f.now - r.pendingSince;
      return trip({
        check: "ci-slow",
        subject: `${r.projectId}#${r.prNumber}:${r.head.slice(0, 8)}`,
        severity: severityOf(age, limit),
        line: `CI on PR #${r.prNumber} has been pending ${duration(age)}; it usually settles within ${duration(limit)}.`,
        workspaceId: r.workspaceId,
        detail: { prNumber: r.prNumber, head: r.head, limitMs: limit },
      });
    });
}

export function armedStuck(f: HealthFacts, c: HealthConfig): Trip[] {
  const limit = c.armedStuckMinutes * MIN;
  return f.armed
    .filter((a) => f.now - a.armedAt >= limit)
    .map((a) => {
      const age = f.now - a.armedAt;
      return trip({
        check: "armed-stuck",
        subject: a.sessionId,
        severity: severityOf(age, limit),
        line: `PR${a.prNumber ? ` #${a.prNumber}` : ""} of ${a.name} has been armed ${duration(age)} without merging.`,
        workspaceId: a.workspaceId,
        detail: { prNumber: a.prNumber },
      });
    });
}

export function serverErrors(f: HealthFacts, c: HealthConfig): Trip[] {
  const limit = Math.max(
    c.serverErrorsMin,
    c.serverErrorsFactor * f.errors.baselineMean
  );
  if (f.errors.recent < limit) return [];
  return [
    trip({
      check: "server-errors",
      subject: "server",
      severity: f.errors.recent >= limit * 2 ? "high" : "warn",
      line: `${f.errors.recent} server errors in the last 10 minutes (usually ${Math.round(f.errors.baselineMean)}).`,
      detail: { recent: f.errors.recent },
    }),
  ];
}

export function runDetectors(f: HealthFacts, c: HealthConfig): Trip[] {
  return [
    ...loadRed(f, c),
    ...queueHeld(f, c),
    ...bgQuiet(f, c),
    ...restarts(f, c),
    ...ciSlow(f, c),
    ...armedStuck(f, c),
    ...serverErrors(f, c),
  ];
}

// --- piece-dup: raised where a piece is about to start, not on the tick ---

const STOP = new Set(
  "a an and the of to for in on with from by is are as at be it this that into add fix feat feature update make use new piece slice".split(
    " "
  )
);

export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []) {
    if (STOP.has(w)) continue;
    out.add(w.replace(/(ing|ed|es|s)$/, ""));
  }
  return out;
}

// How much of the piece's words the merged work's words cover, 0 to 1.
export function overlap(piece: string, merged: string): number {
  const a = words(piece);
  if (!a.size) return 0;
  const b = words(merged);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

export interface MergedWork {
  sessionId: string;
  prNumber: number | null;
  text: string;
}

export function matchingMerge(
  piece: { name: string; slice: string },
  merged: MergedWork[],
  threshold: number
): { work: MergedWork; score: number } | null {
  const text = `${piece.name} ${piece.slice}`;
  let best: { work: MergedWork; score: number } | null = null;
  for (const work of merged) {
    const score = overlap(text, work.text);
    if (score >= threshold && (!best || score > best.score))
      best = { work, score };
  }
  return best;
}
