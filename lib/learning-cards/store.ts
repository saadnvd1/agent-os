import { db } from "../db";
import type {
  Card,
  CardKind,
  CardStatus,
  Destination,
  LessonPayload,
  RecipePayload,
} from "./types";

interface Row extends Omit<Card, "payload"> {
  payload: string;
}

const toCard = (r: Row): Card => ({ ...r, payload: JSON.parse(r.payload) });

export function getCard(id: number): Card | null {
  const row = db
    .prepare(`SELECT * FROM learning_cards WHERE id = ?`)
    .get(id) as Row | undefined;
  return row ? toCard(row) : null;
}

export function listCards(sessionId: string, status?: CardStatus): Card[] {
  const rows = db
    .prepare(
      `SELECT * FROM learning_cards WHERE session_id = ?
       AND (? IS NULL OR status = ?) ORDER BY id`
    )
    .all(sessionId, status ?? null, status ?? null) as Row[];
  return rows.map(toCard);
}

// One card per kind per session; a second insert is ignored.
export function insertCard(c: {
  sessionId: string;
  workspaceId: string | null;
  kind: CardKind;
  payload: RecipePayload | LessonPayload;
  destination?: Destination;
}): Card | null {
  const { lastInsertRowid, changes } = db
    .prepare(
      `INSERT OR IGNORE INTO learning_cards
         (session_id, workspace_id, kind, payload, destination, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      c.sessionId,
      c.workspaceId,
      c.kind,
      JSON.stringify(c.payload),
      c.destination ?? null,
      Date.now()
    );
  return changes ? getCard(Number(lastInsertRowid)) : null;
}

// Takes the card for deciding; false when someone else already did.
export function claimCard(id: number): boolean {
  return (
    db
      .prepare(
        `UPDATE learning_cards SET status = 'accepted' WHERE id = ? AND status = 'pending'`
      )
      .run(id).changes === 1
  );
}

export function releaseCard(id: number): void {
  db.prepare(
    `UPDATE learning_cards SET status = 'pending' WHERE id = ? AND status = 'accepted' AND decided_at IS NULL`
  ).run(id);
}

export function settleCard(
  id: number,
  status: "accepted" | "dismissed",
  appliedRef: string | null,
  payload?: RecipePayload | LessonPayload
): void {
  db.prepare(
    `UPDATE learning_cards SET status = ?, applied_ref = ?, decided_at = ?,
       payload = COALESCE(?, payload) WHERE id = ?`
  ).run(
    status,
    appliedRef,
    Date.now(),
    payload ? JSON.stringify(payload) : null,
    id
  );
}

// First time a card is read: stamp it, and say whether this call did.
export function markShown(id: number): boolean {
  return (
    db
      .prepare(
        `UPDATE learning_cards SET shown_at = ? WHERE id = ? AND shown_at IS NULL`
      )
      .run(Date.now(), id).changes === 1
  );
}
