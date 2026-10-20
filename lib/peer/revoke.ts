/**
 * Suspending links when the account says so, and lifting that when it says
 * otherwise. A pin is never deleted here: a machine removed from the
 * account by mistake comes back linked as soon as its key is listed again,
 * with no new pairing. The account can only take trust away this way, never
 * add it: a pin it didn't suspend is never touched, and a suspended pin is
 * resumed only with the very key it was paired with.
 */

import { allPins, resumePin, suspendPin, type PeerPin } from "./links";
import { NEEDS_PRO, REMOVED_FROM_ACCOUNT } from "./reasons";

export { NEEDS_PRO, REMOVED_FROM_ACCOUNT };

const OURS: ReadonlySet<string> = new Set([REMOVED_FROM_ACCOUNT, NEEDS_PRO]);

export interface AccountSays {
  /** The plan's answer; null when it hasn't said. */
  linkMachines: boolean | null;
  /** Each listed machine's signing key, or null when this isn't a fresh list. */
  listed: Map<string, string> | null;
}

/** What this pin's state should be, or null to leave it as it is. */
export function wanted(
  pin: PeerPin,
  says: AccountSays
): { state: "active" } | { state: "suspended"; reason: string } | null {
  if (pin.state === "suspended" && !OURS.has(pin.suspendedReason ?? ""))
    return null;
  if (says.linkMachines === false)
    return { state: "suspended", reason: NEEDS_PRO };
  const key = says.listed?.get(pin.machineId);
  if (says.listed && key !== pin.signPub)
    return { state: "suspended", reason: REMOVED_FROM_ACCOUNT };
  if (pin.state === "active") return null;
  const lifted =
    pin.suspendedReason === NEEDS_PRO
      ? says.linkMachines === true
      : says.listed !== null && key === pin.signPub;
  return lifted ? { state: "active" } : null;
}

export interface Changed {
  hostId: string;
  state: "active" | "suspended";
  reason: string | null;
}

/** Applies what the account says to every pin; returns what changed. */
export function reconcilePins(
  says: AccountSays,
  pins: PeerPin[] = allPins()
): Changed[] {
  const changed: Changed[] = [];
  for (const pin of pins) {
    const want = wanted(pin, says);
    if (!want) continue;
    if (want.state === "active") {
      resumePin(pin.hostId);
      changed.push({ hostId: pin.hostId, state: "active", reason: null });
    } else if (
      pin.state !== "suspended" ||
      pin.suspendedReason !== want.reason
    ) {
      suspendPin(pin.hostId, want.reason);
      changed.push({
        hostId: pin.hostId,
        state: "suspended",
        reason: want.reason,
      });
    }
  }
  return changed;
}
