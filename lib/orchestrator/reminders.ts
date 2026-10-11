/**
 * remind_me, reminders and cancel_reminder: the orchestrator's one-off
 * schedules. A reminder is a schedule that messages the workspace's own
 * orchestrator once, so it arrives as a scheduled prompt and never as an
 * approval. Every call is scoped to the caller's workspace, and only reminders
 * an orchestrator made can be cancelled here: Saad's are his to change.
 */

import {
  archiveSchedule,
  createSchedule,
  getSessionRow,
  listSchedules,
  type Schedule,
} from "../schedules/store";
import { reminderName } from "../schedules";
import { DEFAULT_TIMEZONE, formatRunTime } from "../schedules/cron";
import { parseWhen, relativeTime } from "../schedules/when";
import { getOrchestrator } from "./home";
import { addNote } from "./notes";

const SHOW_DONE = 3;

const line = (s: Schedule) =>
  `${s.id.slice(0, 8)}  ${s.name}: ${formatRunTime(s.run_at ?? 0, s.timezone)} (${relativeTime(s.run_at ?? 0)})`;

const madeByOrchestrator = (s: Schedule) =>
  getSessionRow(s.created_by_session_id ?? "")?.role === "orchestrator";

export function remindMe(
  w: string,
  at: string,
  prompt: string,
  name?: string
): string {
  const me = getOrchestrator(w);
  if (!me) throw new Error("This workspace has no orchestrator");
  const runAt = parseWhen(at, DEFAULT_TIMEZONE);
  const schedule = createSchedule({
    workspaceId: w,
    name: name?.trim() || reminderName(w, runAt, DEFAULT_TIMEZONE),
    at: runAt,
    timezone: DEFAULT_TIMEZONE,
    prompt,
    kind: "orchestrator",
    createdBySessionId: me.id,
  });
  addNote(
    w,
    `Reminder set: ${schedule.name}, ${line(schedule).split(": ")[1]}`
  );
  return `Reminder ${schedule.id.slice(0, 8)} set for ${formatRunTime(runAt, DEFAULT_TIMEZONE)} (${relativeTime(runAt)}). It reaches you as a scheduled prompt, not an approval.`;
}

export function listReminders(w: string): string {
  const all = listSchedules(w).filter((s) => s.run_at != null);
  const upcoming = all
    .filter((s) => s.enabled && !s.done_at)
    .sort((a, b) => (a.run_at ?? 0) - (b.run_at ?? 0));
  const done = all
    .filter((s) => s.done_at)
    .sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0))
    .slice(0, SHOW_DONE);
  if (!upcoming.length && !done.length) return "No reminders.";
  return [
    upcoming.length
      ? `Upcoming:\n${upcoming.map(line).join("\n")}`
      : "None upcoming.",
    done.length
      ? `Recently done:\n${done.map((s) => `${s.id.slice(0, 8)}  ${s.name}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function cancelReminder(w: string, id: string): string {
  const ref = id.trim();
  const matches = listSchedules(w).filter(
    (s) =>
      s.run_at != null &&
      !s.done_at &&
      (s.id === ref || (ref.length >= 6 && s.id.startsWith(ref)))
  );
  // Another workspace's, a done one and one Saad made all read the same.
  if (matches.length !== 1 || !madeByOrchestrator(matches[0]))
    throw new Error(`No reminder "${ref}" in this workspace`);
  archiveSchedule(matches[0].id);
  addNote(w, `Reminder cancelled: ${matches[0].name}`);
  return `Reminder ${matches[0].id.slice(0, 8)} cancelled.`;
}
