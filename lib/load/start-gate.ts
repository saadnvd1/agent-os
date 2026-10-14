/**
 * The start gate and the per-machine start bookkeeping, apart from the
 * monitor so the monitor can feed it without a cycle.
 */

import type { LoadLevel } from "./level";
import { LOAD_SETTLE_MS } from "../tasks/schedule";

// A simulator takes about this long to boot and hold a lease.
export const HEAVY_BOOT_MS = 2 * 60_000;

// Closed while red; opens once the level has stayed out of red for the
// settle time. Before the first sample it is closed too ("reading").
export class StartGate {
  private lastRedAt: number | null = null;
  private seen = false;

  constructor(private settleMs = LOAD_SETTLE_MS) {}

  // True when the gate's answer changed (the queue may start something).
  feed(level: LoadLevel, now: number): boolean {
    const before = this.view(now, level);
    this.seen = true;
    if (level === "red") this.lastRedAt = now;
    const after = this.view(now, level);
    return before.reading !== after.reading || before.settled !== after.settled;
  }

  view(now: number, level: LoadLevel | null) {
    const calm = this.lastRedAt === null ? Infinity : now - this.lastRedAt;
    const settled = this.seen && level !== "red" && calm >= this.settleMs;
    return {
      reading: !this.seen,
      settled,
      settleLeftMs:
        this.lastRedAt === null ? 0 : Math.max(0, this.settleMs - calm),
    };
  }
}

interface Starts {
  auto: number | null;
  heavy: number[];
}

const g = globalThis as unknown as {
  __agentosStartGates?: Map<string, StartGate>;
  __agentosMachineStarts?: Map<string, Starts>;
};
const gates = (g.__agentosStartGates ??= new Map<string, StartGate>());
export const startsBy = (g.__agentosMachineStarts ??= new Map<
  string,
  Starts
>());

export const LOCAL = "local";

export const gateOf = (hostId: string) => {
  let gate = gates.get(hostId);
  if (!gate) gates.set(hostId, (gate = new StartGate()));
  return gate;
};

// Fed by the monitor after each sample, and by the peer poll. True when it
// opened or closed.
export function feedGate(hostId: string, level: LoadLevel, now = Date.now()) {
  return gateOf(hostId).feed(level, now);
}

// An automatic start on a machine just happened (or was placed there).
export function recordAutoStart(
  hostId: string,
  heavy: boolean,
  now = Date.now()
): void {
  const s = startsBy.get(hostId) ?? { auto: null, heavy: [] };
  s.auto = now;
  if (heavy) s.heavy.push(now);
  startsBy.set(hostId, s);
}

export function resetMachineStarts(): void {
  startsBy.clear();
  gates.clear();
}

// Whether automatic starts may go ahead on a machine, by its gate alone.
export function gateOpen(
  hostId: string,
  level: LoadLevel | null,
  now: number
): boolean {
  const v = gateOf(hostId).view(now, level);
  return v.settled && !v.reading;
}
