// Which of two overlapping claims keeps going. Both servers must reach the
// same answer without talking, so only fields both see are used.

import type { Claim } from "./types";

// Started times this close count as a tie: age_s crosses the wire in seconds.
export const TIE_WINDOW_MS = 2 * 60_000;

type Rank = Pick<Claim, "id" | "prUrl" | "startedAt">;

// The claim that keeps going. An open PR beats none, then the earlier start,
// then the lexically smaller id. Symmetric: winner(a, b) is winner(b, a).
export function winner<T extends Rank>(a: T, b: T): T {
  if (!!a.prUrl !== !!b.prUrl) return a.prUrl ? a : b;
  if (Math.abs(a.startedAt - b.startedAt) > TIE_WINDOW_MS)
    return a.startedAt < b.startedAt ? a : b;
  return a.id < b.id ? a : b;
}

export const whoYields = <T extends Rank>(a: T, b: T): T =>
  winner(a, b) === a ? b : a;

export const pairKey = (a: Pick<Claim, "id">, b: Pick<Claim, "id">) =>
  [a.id, b.id].sort().join("|");
