// The strong overlaps that touch a session on this machine, each seen from
// that session's side. Pure over the claims it is given.

import { findOverlaps } from "./overlap";
import { pairKey, whoYields } from "./yield";
import type { Claim } from "./types";

export interface SessionOverlap {
  sessionId: string;
  pairKey: string;
  mine: Claim;
  other: Claim;
  shared: string[];
  kinds: ("branch" | "files" | "goal")[];
  // This session is the one asked to give way.
  yields: boolean;
}

export function sessionOverlaps(
  self: string,
  claims: Claim[]
): SessionOverlap[] {
  const out: SessionOverlap[] = [];
  for (const o of findOverlaps(claims)) {
    if (o.strength !== "strong") continue;
    const yielder = whoYields(o.a, o.b);
    for (const [mine, other] of [
      [o.a, o.b],
      [o.b, o.a],
    ] as const)
      if (mine.origin === self && mine.sessionId)
        out.push({
          sessionId: mine.sessionId,
          pairKey: pairKey(o.a, o.b),
          mine,
          other,
          shared: o.shared,
          kinds: o.kinds,
          yields: yielder === mine,
        });
  }
  return out;
}
