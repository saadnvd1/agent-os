import { getDb } from "@/lib/db";
import type { ContextItem } from "./types";

interface Row {
  item_id: string;
  kind: "user" | "assistant";
  text: string | null;
  created_at: number | null;
  seq: number;
}

const COLS = `item_id, kind, seq, json_extract(data, '$.text') AS text,
              json_extract(data, '$.createdAt') AS created_at`;

// A message and the ones said just before and after it, in order. Null when
// the message is gone. Only text: images and files stay out of a preview.
export function getMessageContext(
  sessionId: string,
  itemId: string,
  around = 3
): ContextItem[] | null {
  const db = getDb();
  const hit = db
    .prepare(
      `SELECT ${COLS} FROM chat_items WHERE session_id = ? AND item_id = ?`
    )
    .get(sessionId, itemId) as Row | undefined;
  if (!hit) return null;
  const side = (op: "<" | ">", order: "ASC" | "DESC") =>
    db
      .prepare(
        `SELECT ${COLS} FROM chat_items
         WHERE session_id = ? AND kind IN ('user', 'assistant') AND seq ${op} ?
         ORDER BY seq ${order} LIMIT ?`
      )
      .all(sessionId, hit.seq, around) as Row[];
  const rows = [...side("<", "DESC").reverse(), hit, ...side(">", "ASC")];
  return rows.map((r) => ({
    id: r.item_id,
    role: r.kind,
    text: r.text ?? "",
    createdAt: r.created_at,
    hit: r.item_id === itemId,
  }));
}
