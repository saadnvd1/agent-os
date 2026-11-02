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
import { awayWindowMinutes } from "./activity";
import { owner, Owner } from "../owner";

export function awayOnLine(row: AwayRow, now = Date.now()): string {
  return `${Owner()} is away (Away mode, since ${clockTime(fromSql(row.started_at), now)}, ${untilText(row, now)}). Follow work through rather than only reacting to events: keep each task moving to merged and deployed, sign off what passes its gates, and pick up what stalled. Every ${SWEEP_EVERY_MS / 60000} minutes AgentOS sweeps this workspace without messaging any session: it runs lost reviews again, checks the deploy after each merge, and sends you one digest of what's new (stalled tasks, idle ones with uncommitted work and no PR, ${owner()}'s own sessions idle with uncommitted work). You decide what needs work and act with your tools. Only sessions with real activity in the last ${awayWindowMinutes()} minutes are listed: leave the rest alone, since a message wakes an agent and re-reads its whole context. Interactive sessions (not tasks) are ${owner()}'s: ask a listed one at most once to wrap up, never drive them further. Hard lines still go to ask_owner; while he's away his asks reach his phone in one batch per sweep, so raise them as usual. \`aos notify\` is held for that batch too, so don't send one per item.`;
}

// For the digest: the same line whenever Away is on, messaged or not, so an
// orchestrator skipped at the toggle still knows when it next starts.
export function awayDigestLine(now = Date.now()): string | null {
  const row = activeAway();
  return row ? awayOnLine(row, now) : null;
}
