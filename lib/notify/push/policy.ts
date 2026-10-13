/** Which events the quiet rules apply to. Pure. */

import type { PushCategory } from "../push-types";

/** Alerting pushes per device per rolling hour; beyond it, one summary. */
export const CAP_PER_HOUR = 10;
export const HOUR_MS = 3_600_000;
/** The Mac counts as "being used" when the keyboard or mouse moved this recently. */
export const AT_MAC_MS = 3 * 60_000;
/** A needs-you push waits this long, and is dropped if the session moves on. */
export const WAIT_MS = 60_000;

/** At the desk he sees these there. Asks are escalations and always push. */
const PRESENCE_GATED: ReadonlySet<PushCategory> = new Set([
  "needs-you",
  "review",
  "plan",
  "ci",
  "merged",
]);
/** While Away is on these wait for its 10-minute digest. */
const FOLDS_WHEN_AWAY: ReadonlySet<PushCategory> = new Set([
  "needs-you",
  "review",
  "plan",
  "ci",
  "merged",
  "agents",
  "system",
]);
const CAP_EXEMPT: ReadonlySet<PushCategory> = new Set(["asks"]);

export const presenceGated = (c: PushCategory) => PRESENCE_GATED.has(c);
export const foldsWhenAway = (c: PushCategory) => FOLDS_WHEN_AWAY.has(c);
export const capExempt = (c: PushCategory) => CAP_EXEMPT.has(c);
