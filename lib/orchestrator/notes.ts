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
import { actorIn } from "../leads/actor";
import { getLead } from "../leads/home";
import { memberKind } from "../leads/roles";
import { TECH, type LeadKind } from "../leads/types";

export type NoteKind =
  | "note"
  | "brake"
  | "escalation"
  | "ask"
  | "pause"
  // What Away mode's sweep did (lib/away).
  | "away";

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
  kind: NoteKind = "note",
  // Whose log it goes in: the lead (or chief) calling, else the one named,
  // else Tech.
  lead?: LeadKind
): NoteRow {
  const body = text.trim().slice(0, NOTE_CAP);
  if (!body) throw new Error("The note is empty");
  const actor = actorIn(workspaceId);
  const leadKind = lead ?? (actor && memberKind(actor)) ?? TECH;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO orchestrator_notes (workspace_id, kind, text, lead_kind) VALUES (?, ?, ?, ?)`
    )
    .run(workspaceId, kind, body, leadKind);
  const orchestrator =
    leadKind === TECH
      ? getOrchestrator(workspaceId)
      : getLead(workspaceId, leadKind);
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
