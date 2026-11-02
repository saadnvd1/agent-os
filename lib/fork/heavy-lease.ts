/**
 * Slots for the builds and test runs of fork children. `aos heavy` from a
 * fork child asks for one and waits its turn, so N children never run N
 * suites at once, and none start while the machine's load reads red.
 * First come, first served; a lease the child's CLI stopped renewing (or
 * whose process is gone) is taken back.
 */

import { currentLevel, loadEnabled } from "../load/monitor";
import { bumpHeavy } from "./ledger";
import { FORK_LIMITS } from "./options";

interface Lease {
  sessionId: string;
  pid: number;
  askedAt: number;
  seen: number;
  grantedAt: number | null;
}

// A holder that hasn't asked again within this long is gone.
export const LEASE_STALE_MS = 30_000;

const g = globalThis as unknown as { __agentosForkLeases?: Lease[] };
const leases = (g.__agentosForkLeases ??= []);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function slotsNow(): number {
  if (!loadEnabled()) return FORK_LIMITS.heavySlotsCalm;
  return currentLevel() === "green" || currentLevel() === null
    ? FORK_LIMITS.heavySlotsCalm
    : FORK_LIMITS.heavySlots;
}

function reap(now: number) {
  for (let i = leases.length - 1; i >= 0; i--) {
    const l = leases[i];
    if (now - l.seen > LEASE_STALE_MS || !alive(l.pid)) leases.splice(i, 1);
  }
}

function grant(now: number) {
  const held = leases.filter((l) => l.grantedAt !== null).length;
  const room = Math.max(0, slotsNow() - held);
  if (!room) return;
  // No new run while the machine is loaded; what already runs finishes.
  if (loadEnabled() && currentLevel() === "red") return;
  let n = room;
  for (const l of leases) {
    if (n === 0) break;
    if (l.grantedAt === null) {
      l.grantedAt = now;
      n--;
      bumpHeavy(l.sessionId);
    }
  }
}

export interface LeaseState {
  granted: boolean;
  // Runs queued before this one, or running in its way.
  ahead: number;
}

// Asks for a slot, or renews the one held; the same caller asks again until
// it is granted.
export function requestLease(
  sessionId: string,
  pid: number,
  now = Date.now()
): LeaseState {
  reap(now);
  let mine = leases.find((l) => l.sessionId === sessionId && l.pid === pid);
  if (mine) mine.seen = now;
  else
    leases.push(
      (mine = { sessionId, pid, askedAt: now, seen: now, grantedAt: null })
    );
  grant(now);
  if (mine.grantedAt !== null) return { granted: true, ahead: 0 };
  return {
    granted: false,
    ahead: leases.filter(
      (l) => l !== mine && (l.grantedAt !== null || l.askedAt <= mine!.askedAt)
    ).length,
  };
}

export function releaseLease(sessionId: string, pid: number): void {
  const i = leases.findIndex((l) => l.sessionId === sessionId && l.pid === pid);
  if (i >= 0) leases.splice(i, 1);
  grant(Date.now());
}

export const leaseCount = () => leases.length;
export const resetLeases = () => void leases.splice(0, leases.length);
