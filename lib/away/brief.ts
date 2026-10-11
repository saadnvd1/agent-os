/**
 * What an orchestrator is told while Saad is away: the event that turns
 * Away on, and the line leading its brief's digest on a fresh start.
 */

import {
  activeAway,
  clockTime,
  fromSql,
  untilText,
  type AwayRow,
} from "./state";
import { SWEEP_EVERY_MS } from "./sweep";

export function awayOnLine(row: AwayRow, now = Date.now()): string {
  return `Saad is away (Away mode, since ${clockTime(fromSql(row.started_at), now)}, ${untilText(row, now)}). Follow work through rather than only reacting to events: keep each task moving to merged and deployed, sign off what passes its gates, and pick up what stalled. Every ${SWEEP_EVERY_MS / 60000} minutes AgentOS sweeps: it nudges stalled tasks, asks idle ones with uncommitted work to commit and open a PR, runs lost reviews again and checks the deploy after each merge; what needs you comes as events, and each step is in your log. Interactive sessions (not tasks) are Saad's: in Away mode only ask them to wrap up, never drive them further. Hard lines still go to ask_saad; while he's away his asks reach his phone in one batch per sweep, so raise them as usual. \`aos notify\` is held for that batch too, so don't send one per item.`;
}

// For the digest: the same line while Away is on, else nothing.
export function awayDigestLine(now = Date.now()): string | null {
  const row = activeAway();
  return row ? awayOnLine(row, now) : null;
}
