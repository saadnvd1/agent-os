import { db } from "../db";
import type { ChatImage, QueuedMessage } from "./events";

// Messages written while a turn runs, kept in SQLite so a reload or a
// restart never loses them. The worker sends them in order when the turn
// ends; the reader can edit, reorder or drop them until then.

// Enough for any real backlog, and a bound on what one client can pile up.
export const MAX_QUEUED = 50;
export const MAX_QUEUED_TEXT = 100_000;
const MAX_QUEUED_IMAGES = 20 * 1024 * 1024;

interface Row {
  id: string;
  text: string;
  images: string | null;
  created_at: number;
}

// The queue as watchers see it: images counted, not sent along each time.
export function listQueue(sessionId: string): QueuedMessage[] {
  return (
    db
      .prepare(
        `SELECT id, text, json_array_length(images) AS image_count, created_at
         FROM chat_queue WHERE session_id = ? ORDER BY position, created_at`
      )
      .all(sessionId) as {
      id: string;
      text: string;
      image_count: number | null;
      created_at: number;
    }[]
  ).map((r) => ({
    id: r.id,
    text: r.text,
    imageCount: r.image_count ?? undefined,
    createdAt: r.created_at,
  }));
}

// At the back. A retried send with the same id is only queued once.
export function enqueue(
  sessionId: string,
  m: { id: string; text: string; images?: ChatImage[] }
): void {
  const images = m.images?.length ? JSON.stringify(m.images) : null;
  if (m.text.length > MAX_QUEUED_TEXT)
    throw new Error("That message is too long to queue");
  if (images && images.length > MAX_QUEUED_IMAGES)
    throw new Error("Those images are too large to queue");
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM chat_queue WHERE session_id = ?`)
    .get(sessionId) as { n: number };
  if (n >= MAX_QUEUED)
    throw new Error(`The queue is full (${MAX_QUEUED} messages)`);
  db.prepare(
    `INSERT OR IGNORE INTO chat_queue (id, session_id, position, text, images, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM chat_queue WHERE session_id = ?), ?, ?, ?)`
  ).run(m.id, sessionId, sessionId, m.text, images, Date.now());
}

// Takes the first message off the queue: once claimed, it's this caller's
// to send, and an edit or delete racing it finds nothing.
export function claimNext(
  sessionId: string
): { id: string; text: string; images?: ChatImage[] } | null {
  const row = db
    .prepare(
      `DELETE FROM chat_queue WHERE session_id = ? AND id = (
         SELECT id FROM chat_queue WHERE session_id = ?
         ORDER BY position, created_at LIMIT 1
       ) RETURNING id, text, images, created_at`
    )
    .get(sessionId, sessionId) as Row | undefined;
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    images: row.images ? (JSON.parse(row.images) as ChatImage[]) : undefined,
  };
}

// False when it's already gone (sent, or deleted elsewhere).
export function editQueued(
  sessionId: string,
  id: string,
  text: string
): boolean {
  if (text.length > MAX_QUEUED_TEXT) return false;
  return (
    db
      .prepare(`UPDATE chat_queue SET text = ? WHERE session_id = ? AND id = ?`)
      .run(text, sessionId, id).changes > 0
  );
}

export function deleteQueued(sessionId: string, id: string): boolean {
  return (
    db
      .prepare(`DELETE FROM chat_queue WHERE session_id = ? AND id = ?`)
      .run(sessionId, id).changes > 0
  );
}

// Swaps a message with its neighbour, one place earlier (-1) or later (1).
export function moveQueued(sessionId: string, id: string, by: -1 | 1): boolean {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id, position FROM chat_queue WHERE session_id = ?
         ORDER BY position, created_at`
      )
      .all(sessionId) as { id: string; position: number }[];
    const i = rows.findIndex((r) => r.id === id);
    const j = i + by;
    if (i === -1 || j < 0 || j >= rows.length) return false;
    // Renumbered in their new order, so equal positions can't tie.
    [rows[i], rows[j]] = [rows[j], rows[i]];
    const set = db.prepare(
      `UPDATE chat_queue SET position = ? WHERE session_id = ? AND id = ?`
    );
    rows.forEach((r, k) => set.run(k + 1, sessionId, r.id));
    return true;
  })();
}

// To the front, to go next.
export function moveToFront(sessionId: string, id: string): boolean {
  return (
    db
      .prepare(
        `UPDATE chat_queue SET position =
           (SELECT COALESCE(MIN(position), 0) - 1 FROM chat_queue WHERE session_id = ?)
         WHERE session_id = ? AND id = ?`
      )
      .run(sessionId, sessionId, id).changes > 0
  );
}

export function clearQueue(sessionId: string): void {
  db.prepare(`DELETE FROM chat_queue WHERE session_id = ?`).run(sessionId);
}

// Live sessions with something queued since `since` (ms).
export function queuedSessions(since = 0): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT q.session_id AS id FROM chat_queue q
         JOIN sessions s ON s.id = q.session_id
         WHERE s.archived_at IS NULL AND q.created_at >= ?`
      )
      .all(since) as { id: string }[]
  ).map((r) => r.id);
}
