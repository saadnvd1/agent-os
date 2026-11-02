import { experimentOn } from "../experiments";

// The server's limits for forks. Clients read them from /api/client-config
// and never carry their own (lib/config/client-config.ts).
export const FORK_LIMITS = {
  // Children one `aos fork` call may start.
  maxPerFork: 8,
  // Children of one parent not yet settled, all calls together.
  maxOpenPerParent: 16,
  // Children of one parent running at once; the rest wait their turn.
  maxRunningPerParent: 4,
  // Characters of a result's first line the parent's agent sees.
  summaryChars: 300,
  // Characters of a full result kept.
  resultChars: 64_000,
  // Characters of one instruction.
  instructionChars: 4_000,
  // Results that settle within this long of the first go in one delivery,
  // and a delivery never waits longer than the cap after the first.
  batchWindowMs: 20_000,
  batchCapMs: 2 * 60_000,
  // A child idle this long with no `aos return` settles with its final
  // answer, so one about to return gets there first.
  implicitGraceMs: 45_000,
  // Fork children's builds and test runs at once on this machine
  // (lib/fork/heavy-lease); 2 while the machine reads green.
  heavySlots: 1,
  heavySlotsCalm: 2,
} as const;

export const DELIVERY_MODES = ["wake", "next"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const forksOn = (): boolean => experimentOn("forks");

export const FORKS_OFF = "Parallel forks are off (Settings → Experimental)";

// What /api/client-config serves; no client carries these.
export function forkConfig() {
  return {
    enabled: forksOn(),
    maxPerFork: FORK_LIMITS.maxPerFork,
    summaryChars: FORK_LIMITS.summaryChars,
    deliveryModes: [...DELIVERY_MODES],
  };
}
