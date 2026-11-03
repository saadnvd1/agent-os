/**
 * Slots for the builds and test runs on this machine. Every `aos heavy`
 * (a task, a session, a fork child) asks the AgentOS on its own machine for
 * one and waits its turn, so N sessions never run N suites at once. The slot
 * count follows this machine's load: HEAVY_SLOTS_CALM while it reads green,
 * HEAVY_SLOTS otherwise. First come, first served; a lease whose CLI stopped
 * renewing (or whose process is gone) is taken back.
 */

import { bumpHeavy } from "../fork/ledger";
import { currentLevel, loadEnabled } from "./monitor";

// Overridable with AGENTOS_HEAVY_SLOTS / AGENTOS_HEAVY_SLOTS_CALM.
export const HEAVY_SLOTS = 1;
export const HEAVY_SLOTS_CALM = 2;

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

interface Lease {
  sessionId: string | null;
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
  const busy = positive(process.env.AGENTOS_HEAVY_SLOTS, HEAVY_SLOTS);
  const calm = Math.max(
    busy,
    positive(process.env.AGENTOS_HEAVY_SLOTS_CALM, HEAVY_SLOTS_CALM)
  );
  if (!loadEnabled()) return calm;
  return currentLevel() === "green" || currentLevel() === null ? calm : busy;
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
  let n = room;
  for (const l of leases) {
    if (n === 0) break;
    if (l.grantedAt === null) {
      l.grantedAt = now;
      n--;
      if (l.sessionId) bumpHeavy(l.sessionId);
    }
  }
}

export interface LeaseState {
  granted: boolean;
  // Runs queued before this one, or running in its way.
  ahead: number;
}

// Asks for a slot, or renews the one held; the same caller asks again until
// it is granted. `held` is a holder the server doesn't know (it restarted
// since): its run is already going, so it takes a slot at once rather than
// letting a second run start on top of it.
export function requestLease(
  sessionId: string | null,
  pid: number,
  now = Date.now(),
  held = false
): LeaseState {
  reap(now);
  let mine = leases.find((l) => l.sessionId === sessionId && l.pid === pid);
  if (mine) mine.seen = now;
  else
    leases.push(
      (mine = {
        sessionId,
        pid,
        askedAt: now,
        seen: now,
        grantedAt: held ? now : null,
      })
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

export function releaseLease(sessionId: string | null, pid: number): void {
  const i = leases.findIndex((l) => l.sessionId === sessionId && l.pid === pid);
  if (i >= 0) leases.splice(i, 1);
  grant(Date.now());
}

export const leaseCount = () => leases.length;
export const resetLeases = () => void leases.splice(0, leases.length);
