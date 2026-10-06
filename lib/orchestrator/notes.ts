/**
 * The orchestrator's decision log, one table per workspace. Every line also
 * lands in its chat as a note, so the chat stays the log Saad reads.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { emit } from "../chat/registry";
import { saveItem } from "../chat/store";
import type { ChatItem } from "../chat/events";
import { getOrchestrator } from "./home";

export type NoteKind = "note" | "brake" | "escalation" | "ask" | "pause";

export interface NoteRow {
  id: number;
  workspace_id: string;
  kind: NoteKind;
  text: string;
  created_at: string;
}

const NOTE_CAP = 2000;

export function addNote(
  workspaceId: string,
  text: string,
  kind: NoteKind = "note"
): NoteRow {
  const body = text.trim().slice(0, NOTE_CAP);
  if (!body) throw new Error("The note is empty");
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO orchestrator_notes (workspace_id, kind, text) VALUES (?, ?, ?)`
    )
    .run(workspaceId, kind, body);
  const orchestrator = getOrchestrator(workspaceId);
  if (orchestrator) {
    const item: ChatItem = {
      id: `note-${lastInsertRowid}-${randomUUID().slice(0, 5)}`,
      kind: "note",
      text: body,
      tone: kind,
      createdAt: Date.now(),
    };
    saveItem(orchestrator.id, item);
    emit(orchestrator.id, { type: "item", item });
  }
  return db
    .prepare(`SELECT * FROM orchestrator_notes WHERE id = ?`)
    .get(lastInsertRowid) as NoteRow;
}

export function listNotes(workspaceId: string, limit = 50): NoteRow[] {
  return (
    db
      .prepare(
        `SELECT * FROM orchestrator_notes WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`
      )
      .all(workspaceId, limit) as NoteRow[]
  ).reverse();
}
