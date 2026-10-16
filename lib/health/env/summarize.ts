import { db } from "@/lib/db";
import { MIN } from "../types";
import { ENV_CLASSES } from "./classes";
import { fixFor, hasOwnFix } from "./fixText";
import type { EnvSessionView, EnvSummary } from "./types";

const DAY = 24 * 60 * MIN;

interface Group {
  class: string;
  project_id: string | null;
  name: string | null;
  s7: number;
  s30: number;
}

// Sessions that hit each class in the last 7 and 30 days, by project.
export function envSummary(now = Date.now()): EnvSummary {
  const groups = db
    .prepare(
      `SELECT e.class, e.project_id, p.name,
         SUM(e.last_at >= ?) AS s7, COUNT(*) AS s30
       FROM env_failures e LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.last_at >= ? GROUP BY e.class, e.project_id`
    )
    .all(now - 7 * DAY, now - 30 * DAY) as Group[];
  return {
    now,
    classes: ENV_CLASSES.map((c) => {
      const mine = groups.filter((g) => g.class === c.id);
      return {
        id: c.id,
        label: c.label,
        fix: fixFor(c.id),
        fixOverridden: hasOwnFix(c.id),
        sessions7: mine.reduce((n, g) => n + g.s7, 0),
        sessions30: mine.reduce((n, g) => n + g.s30, 0),
        projects: mine
          .map((g) => ({
            id: g.project_id,
            name: g.name ?? "No project",
            sessions7: g.s7,
            sessions30: g.s30,
          }))
          .sort((a, b) => b.sessions30 - a.sessions30),
      };
    }).sort((a, b) => b.sessions30 - a.sessions30),
  };
}

interface Row {
  session_id: string;
  name: string | null;
  project: string | null;
  command: string | null;
  line: string | null;
  hits: number;
  first_at: number;
  last_at: number;
  nudged_at: number | null;
  nudge_skipped: string | null;
}

export function envSessions(
  cls: string,
  days: number,
  now = Date.now()
): EnvSessionView[] {
  const rows = db
    .prepare(
      `SELECT e.session_id, s.name, p.name AS project, e.command, e.line,
         e.hits, e.first_at, e.last_at, e.nudged_at, e.nudge_skipped
       FROM env_failures e
       LEFT JOIN session_rows s ON s.id = e.session_id
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.class = ? AND e.last_at >= ? ORDER BY e.last_at DESC LIMIT 100`
    )
    .all(cls, now - days * DAY) as Row[];
  return rows.map((r) => ({
    sessionId: r.session_id,
    name: r.name ?? r.session_id.slice(0, 8),
    project: r.project,
    command: r.command,
    line: r.line,
    hits: r.hits,
    firstAt: r.first_at,
    lastAt: r.last_at,
    fix: r.nudged_at
      ? "sent"
      : r.nudge_skipped
        ? `not sent (${r.nudge_skipped})`
        : "waiting to send",
  }));
}
