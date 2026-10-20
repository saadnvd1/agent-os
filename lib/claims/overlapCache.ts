// The overlaps of this machine's sessions, worked out once a sync tick so
// /api/sessions needs no git and no pairwise pass per request.

import { findOverlaps } from "./overlap";
import { machineId } from "./machine";
import { liveClaims } from "./store";
import { overlapView, type OverlapView } from "./view";
import type { Claim } from "./types";

// A session row's pill: the strongest overlap it has.
export interface SessionOverlap {
  strength: "strong" | "weak";
  machine: string;
  goal: string;
  shared: number;
  // This session's own claim and the other one: the pair a pill opens.
  claimId: string;
  mineId: string;
}

// A claim without its paths: enough to list on a phone.
export type ClaimSummary = Omit<Claim, "files"> & { fileCount: number };

export interface ClaimsSnapshot {
  claims: ClaimSummary[];
  overlaps: OverlapView[];
  bySession: Map<string, SessionOverlap>;
}

const EMPTY: ClaimsSnapshot = {
  claims: [],
  overlaps: [],
  bySession: new Map(),
};
// server.ts (the loop) and the route bundles are separate module graphs, so
// the snapshot lives on globalThis to be one.
const g = globalThis as unknown as { __agentosClaimsSnapshot?: ClaimsSnapshot };
const get = () => g.__agentosClaimsSnapshot ?? EMPTY;

export const summarize = (c: Claim): ClaimSummary => {
  const { files, ...rest } = c;
  return { ...rest, fileCount: files.length + c.filesMore };
};

const rank = (o: SessionOverlap) =>
  (o.strength === "strong" ? 1e6 : 0) + o.shared;

export function buildSnapshot(claims: Claim[], self: string): ClaimsSnapshot {
  const bySession = new Map<string, SessionOverlap>();
  const overlaps = findOverlaps(claims);
  for (const o of overlaps)
    for (const [mine, other] of [
      [o.a, o.b],
      [o.b, o.a],
    ] as const) {
      if (mine.origin !== self || !mine.sessionId) continue;
      const next: SessionOverlap = {
        strength: o.strength,
        machine: other.originName,
        goal: other.goal,
        shared: o.shared.length,
        claimId: other.id,
        mineId: mine.id,
      };
      const have = bySession.get(mine.sessionId);
      if (!have || rank(next) > rank(have)) bySession.set(mine.sessionId, next);
    }
  return {
    claims: claims.map(summarize),
    overlaps: overlaps.map(overlapView),
    bySession,
  };
}

export function refreshOverlapCache(now = Date.now()): void {
  try {
    g.__agentosClaimsSnapshot = buildSnapshot(liveClaims({ now }), machineId());
  } catch (err) {
    console.error("[claims] overlap cache:", err);
  }
}

export const claimsSnapshot = (): ClaimsSnapshot => get();
export const resetOverlapCache = () => {
  g.__agentosClaimsSnapshot = EMPTY;
};
