import type { AskKind } from "../orchestrator/ask-view";
import type { Criterion, CycleRow, Limits, Score, StopReason } from "./types";

export interface StopCheck {
  limits: Limits;
  startedAt: number;
  // How many cycles have run, errors included; the length of `cycles` by default.
  cycleCount?: number;
  // Oldest first; the cycle just finished is the last.
  cycles: Pick<CycleRow, "n" | "signature" | "score">[];
  criteria: Pick<Criterion, "status">[];
  // The latest cycle's checks all passed.
  green: boolean;
  spentUsd: number;
  now: number;
  userStop?: boolean;
  // The analyst's blocker, a BLOCKED: line, a coder waiting on input, an
  // open ask or a refused instruction: the words for the reader.
  blocked?: string | null;
}

export interface Stop {
  reason: StopReason;
  detail: string;
  // The ask a refused instruction raises, when it crossed a hard line.
  askKind?: AskKind;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// Strictly better: more criteria met, then fewer failing tests, then
// fewer type errors.
export function better(a: Score, b: Score): boolean {
  if (a.met !== b.met) return a.met > b.met;
  if (a.failingTests !== b.failingTests) return a.failingTests < b.failingTests;
  return a.typeErrors < b.typeErrors;
}

function repeated(cycles: StopCheck["cycles"], n: number): string | null {
  if (cycles.length < n) return null;
  const last = cycles.slice(-n);
  const sig = last[0].signature;
  return sig && last.every((c) => c.signature === sig) ? sig : null;
}

// None of the last `n` cycles beat the best before it. A cycle with no
// change scores the same as the one before, so it counts too.
function stalled(cycles: StopCheck["cycles"], n: number): boolean {
  if (cycles.length < n + 1) return false;
  const scored = cycles.map((c) => c.score);
  if (scored.some((s) => !s)) return false;
  const all = scored as Score[];
  let best = all[0];
  for (const s of all.slice(1, all.length - n)) if (better(s, best)) best = s;
  for (const s of all.slice(all.length - n)) {
    if (better(s, best)) return false;
  }
  return true;
}

// The limits alone: checked on every tick, and they stop the next send,
// never a turn that is running.
export function limitStop(
  c: Pick<StopCheck, "limits" | "startedAt" | "spentUsd" | "now"> & {
    cycleCount: number;
  }
): Stop | null {
  const l = c.limits;
  if (c.cycleCount >= l.maxCycles)
    return {
      reason: "limit:cycles",
      detail: `${c.cycleCount} of ${l.maxCycles} cycles used`,
    };
  if (c.spentUsd >= l.maxCostUsd)
    return {
      reason: "limit:cost",
      detail: `${usd(c.spentUsd)} spent of the ${usd(l.maxCostUsd)} cap`,
    };
  const minutes = (c.now - c.startedAt) / 60_000;
  if (minutes >= l.maxMinutes)
    return {
      reason: "limit:time",
      detail: `${Math.round(minutes)} of ${l.maxMinutes} minutes used`,
    };
  return null;
}

// One pure decision at a cycle boundary. First match wins: the user, a
// blocker, done, the same failure again, no progress, then the limits.
export function decideStop(c: StopCheck): Stop | null {
  if (c.userStop) return { reason: "stopped", detail: "stopped by you" };
  if (c.blocked) return { reason: "blocked", detail: c.blocked };
  const open = c.criteria.filter(
    (k) => k.status !== "met" && k.status !== "waived"
  );
  if (c.criteria.length && !open.length && c.green)
    return {
      reason: "done",
      detail: `all ${c.criteria.length} criteria met, checks green`,
    };
  const sig = repeated(c.cycles, c.limits.repeatCycles);
  if (sig)
    return {
      reason: "repeat",
      detail: `the same failure on ${c.limits.repeatCycles} cycles in a row: ${sig.slice(0, 200)}`,
    };
  if (stalled(c.cycles, c.limits.stallCycles))
    return {
      reason: "no_progress",
      detail: `no improvement in ${c.limits.stallCycles} cycles`,
    };
  return limitStop({ ...c, cycleCount: c.cycleCount ?? c.cycles.length });
}
