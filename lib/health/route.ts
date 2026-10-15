/**
 * Where an anomaly is heard: one line in the orchestrator chat, and the
 * phone only when the watcher says it needs the person. Each is sent once
 * per anomaly (keys carry the anomaly id and severity), so one that keeps
 * tripping is one line.
 */

import { notifyPhone } from "../notify";
import { listOrchestrators } from "../orchestrator/home";
import { queueEventOnce } from "../orchestrator/events";
import { untrusted } from "../orchestrator/untrusted";
import { duration } from "./detectors";
import { markDelivered, markPhoned, verdictOf } from "./store";
import { db } from "../db";
import { AREA_LABELS, MIN, type AnomalyRow, type Verdict } from "./types";

// Phone pushes a day, whatever the watchers say.
export const PHONE_CAP_PER_DAY = 5;

export interface RouteDeps {
  queue: typeof queueEventOnce;
  phone: typeof notifyPhone;
  workspaces: () => string[];
}

export const realRoute: RouteDeps = {
  queue: queueEventOnce,
  phone: notifyPhone,
  workspaces: () =>
    listOrchestrators()
      .filter((o) => !o.archived_at && o.workspace_id)
      .map((o) => o.workspace_id as string),
};

export function chatLine(row: AnomalyRow, v: Verdict): string {
  const head = `Health (${AREA_LABELS[row.area].toLowerCase()}${v.unjudged ? ", unjudged" : ""}):`;
  if (v.unjudged) return `${head} ${row.line}`;
  const said = [v.cause, v.action ? `Suggest: ${v.action}` : ""]
    .filter(Boolean)
    .join(" ");
  return `${head} ${row.line} ${untrusted("health watcher", said)}`;
}

function phonedToday(now: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM health_anomalies WHERE phoned_at >= ?`
      )
      .get(now - 24 * 60 * MIN) as { n: number }
  ).n;
}

export function deliver(
  row: AnomalyRow,
  v: Verdict,
  now: number,
  deps: RouteDeps = realRoute
): void {
  // The watcher judged it normal: it's in the panel, not in the chat.
  if (!v.real) {
    markDelivered(row.id, now);
    return;
  }
  const targets = row.workspace_id ? [row.workspace_id] : deps.workspaces();
  const urgent = v.saadOnly || row.severity === "high";
  const line = chatLine(row, v);
  for (const ws of targets)
    deps.queue(
      ws,
      `health:${row.id}:${row.severity}`,
      row.subject,
      line,
      now,
      !urgent
    );
  markDelivered(row.id, now);
  if (v.saadOnly && !row.phoned_at && phonedToday(now) < PHONE_CAP_PER_DAY) {
    // The detector's own words only: nothing a log or a model wrote.
    deps.phone(
      "health",
      `${row.line} It needs you; the details are in the orchestrator chat.`,
      {
        category: "system",
        key: `health:${row.id}`,
        collapse: `health:${row.id}`,
      }
    );
    markPhoned(row.id, now);
  }
}

// After it clears, one short line, only if the chat ever heard of it.
export function deliverClosed(
  row: AnomalyRow,
  now: number,
  deps: RouteDeps = realRoute
): void {
  if (!row.delivered_at || row.close_reason !== "cleared") return;
  const v = verdictOf(row);
  if (!v?.real) return;
  const text = `Health (${AREA_LABELS[row.area].toLowerCase()}): cleared after ${duration((row.closed_at ?? now) - row.opened_at)}: ${row.check_id} on ${row.subject}.`;
  const targets = row.workspace_id ? [row.workspace_id] : deps.workspaces();
  for (const ws of targets)
    deps.queue(ws, `health:${row.id}:closed`, row.subject, text, now, true);
}
