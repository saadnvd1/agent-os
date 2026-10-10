/**
 * A chat task's half of a move: its agent stopped between turns, and what
 * the chat view holds (its history, its queue, its settings) packed up on
 * the machine it leaves and written back under the new row where it lands.
 * The Claude conversation itself travels as the transcript, like a
 * terminal task's; the worker that starts on arrival resumes it.
 */

import { db, type Session } from "../db";
import { settle, listItems } from "../chat/store";
import { stopChatAtTurnEnd } from "../chat/stop";
import { rewritePaths } from "./transcript";
import { MAX_CHAT_BYTES, type ChatBundle } from "./move-bundle";

// A turn this long is left to finish: the move is refused, not cut short.
export const MOVE_TURN_WAIT_MS = 3 * 60_000;

export async function stopChatForMove(
  id: string,
  onWait: () => void,
  waitMs = MOVE_TURN_WAIT_MS
): Promise<void> {
  const stop = await stopChatAtTurnEnd(id, { waitMs, onWait });
  if (!stop.stopped) throw new Error(`Not moving it: ${stop.reason}`);
}

export function packChat(session: Session): ChatBundle {
  // Its worker is gone, so nothing is still streaming.
  const items = settle(listItems(session.id)).map((item) => ({
    id: item.id,
    data: JSON.stringify(item),
  }));
  const queue = (
    db
      .prepare(
        `SELECT id, text, images, sent_by, created_at FROM chat_queue
         WHERE session_id = ? ORDER BY position, created_at`
      )
      .all(session.id) as {
      id: string;
      text: string;
      images: string | null;
      sent_by: string | null;
      created_at: number;
    }[]
  ).map((r) => ({
    id: r.id,
    text: r.text,
    images: r.images,
    sentBy: r.sent_by,
    createdAt: r.created_at,
  }));
  const chat: ChatBundle = {
    items,
    queue,
    access: session.chat_access,
    plan: !!session.chat_plan,
    resumeAt: session.chat_resume_at,
    context: session.chat_context,
  };
  const bytes =
    items.reduce((n, i) => n + i.id.length + i.data.length, 0) +
    queue.reduce((n, m) => n + m.text.length + (m.images?.length ?? 0), 0);
  if (bytes > MAX_CHAT_BYTES) throw new Error("The chat is too large to move");
  return chat;
}

/**
 * Writes the chat under the arriving row, its paths moved to this machine's.
 * Run inside the transaction that makes the row.
 */
export function unpackChat(
  id: string,
  chat: ChatBundle,
  paths: {
    from: { cwd: string; home: string };
    to: { cwd: string; home: string };
  } | null
): void {
  const local = (text: string) =>
    paths ? rewritePaths(text, paths.from, paths.to) : text;
  db.prepare(
    `UPDATE sessions SET view = 'chat', chat_access = ?, chat_plan = ?,
       chat_resume_at = ?, chat_context = ? WHERE id = ?`
  ).run(chat.access, chat.plan ? 1 : 0, chat.resumeAt, chat.context, id);
  const item = db.prepare(
    `INSERT OR IGNORE INTO chat_items (session_id, item_id, seq, data) VALUES (?, ?, ?, ?)`
  );
  chat.items.forEach((i, n) => item.run(id, i.id, n + 1, local(i.data)));
  const queued = db.prepare(
    `INSERT OR IGNORE INTO chat_queue (id, session_id, position, text, images, image_count, sent_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  chat.queue.forEach((m, n) =>
    queued.run(
      m.id,
      id,
      n + 1,
      m.text,
      m.images,
      m.images ? imageCount(m.images) : 0,
      m.sentBy,
      m.createdAt
    )
  );
}

const imageCount = (images: string) => {
  try {
    const list = JSON.parse(images);
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
};

/** A failed arrival leaves no chat behind under the row it deletes. */
export function dropChat(id: string): void {
  db.prepare(`DELETE FROM chat_items WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM chat_queue WHERE session_id = ?`).run(id);
}
