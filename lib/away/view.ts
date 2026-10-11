// What the browser gets: Away's state now, and the newest report Saad
// hasn't dismissed. Times are ISO.

import type { AwayReport } from "./report";
import {
  activeAway,
  fromSql,
  isExpired,
  unseenReport,
  type AwayRow,
} from "./state";
import { turnAwayOff } from "./run";

export interface AwayView {
  away: {
    id: number;
    setBy: string;
    startedAt: string;
    expiresAt: string | null;
  } | null;
  report: AwayReport | null;
}

const iso = (t: string) => new Date(fromSql(t)).toISOString();

function reportOf(row: AwayRow | null): AwayReport | null {
  if (!row?.report) return null;
  try {
    return JSON.parse(row.report) as AwayReport;
  } catch {
    return null;
  }
}

export function awayView(now = Date.now()): AwayView {
  let away = activeAway();
  // The watcher ends it on time; this covers a server running without one.
  if (away && isExpired(away, now)) {
    turnAwayOff("expired", now);
    away = null;
  }
  return {
    away: away && {
      id: away.id,
      setBy: away.set_by,
      startedAt: iso(away.started_at),
      expiresAt: away.expires_at ? iso(away.expires_at) : null,
    },
    report: reportOf(unseenReport()),
  };
}
