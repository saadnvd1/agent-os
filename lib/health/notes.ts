/**
 * What normal looks like, per area: short lines a watcher reads before it
 * judges. Seeds are generic and ship with the code; anything machine- or
 * person-specific is learned at run time and lives only in the local
 * database, where Saad can edit or delete it.
 */

import { db } from "../db";
import { AREAS, type Area } from "./types";

export const SEED_NOTES: Record<Area, string[]> = {
  scheduler: [
    "Load spikes while a task runs a simulator, a full build or a test suite, and is back to normal within minutes.",
    "A queued task waits while the load gate is closed or the workspace's running-task slots are full; plan-only tasks never hold a slot.",
    "A paused task gives its slot back.",
  ],
  pipeline: [
    "CI duration is per repository; a run slightly over its usual time is normal, one at several times it usually is not.",
    "An armed PR waits for CI, the independent review and the scope check; an armed PR whose gate keeps failing is waiting for its task, not stuck.",
    "A restart during a deploy is expected; three or more within an hour is not.",
  ],
  tasks: [
    "Builds and test suites can print nothing for a few minutes; a job quiet for much longer, or that never printed anything, deserves a look at whether its process is still running.",
    "A background monitor waits for a marker line; if the job it watches failed, the marker never comes.",
  ],
};

export interface NoteRow {
  id: number;
  area: Area;
  line: string;
  source: "watcher" | "saad";
  created_at: number;
}

export const MAX_NOTE = 200;
const SHOWN = 40;

export function addNote(
  area: Area,
  line: string,
  source: NoteRow["source"],
  now = Date.now()
): number | null {
  const text = line.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  if (!text || !AREAS.includes(area)) return null;
  const same = db
    .prepare(`SELECT 1 FROM watcher_notes WHERE area = ? AND line = ?`)
    .get(area, text);
  if (same) return null;
  const info = db
    .prepare(
      `INSERT INTO watcher_notes (area, line, source, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(area, text, source, now);
  return Number(info.lastInsertRowid);
}

export const listNotes = (area?: Area) =>
  (area
    ? db
        .prepare(`SELECT * FROM watcher_notes WHERE area = ? ORDER BY id`)
        .all(area)
    : db.prepare(`SELECT * FROM watcher_notes ORDER BY id`).all()) as NoteRow[];

export const deleteNote = (id: number): boolean =>
  db.prepare(`DELETE FROM watcher_notes WHERE id = ?`).run(id).changes > 0;

// The seeds, then the newest learned lines.
export function notesFor(area: Area): string[] {
  const learned = listNotes(area)
    .slice(-SHOWN)
    .map((n) => n.line);
  return [...SEED_NOTES[area], ...learned];
}
