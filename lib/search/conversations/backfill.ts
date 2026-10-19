import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { SCHEMA_VERSION, SEARCHED_KINDS } from "./schema";

const BATCH = 500;

interface State {
  version: number;
  cursor: number;
  backfill_to: number;
  done: number;
}

const stateOf = (db: Database.Database): State | undefined =>
  db.prepare(`SELECT * FROM chat_search_state WHERE id = 1`).get() as
    State | undefined;

// Starts the index over: the stored version is not this build's.
function reset(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`DELETE FROM chat_search; DELETE FROM chat_search_keys`);
    db.prepare(
      `UPDATE chat_search_state SET version = ?, cursor = 0, done = 0,
         backfill_to = (SELECT COALESCE(MAX(rowid), 0) FROM chat_items)
       WHERE id = 1`
    ).run(SCHEMA_VERSION);
  })();
}

// Indexes one batch of the chats that were already there when the index was
// made, in rowid order, and records where it got to in the same transaction:
// stopped at any point, the next call carries on. Returns true when finished.
export function backfillStep(db: Database.Database, batch = BATCH): boolean {
  const state = stateOf(db);
  if (!state) return true;
  if (state.version !== SCHEMA_VERSION) reset(db);
  else if (state.done) return true;
  const { cursor, backfill_to } = stateOf(db)!;
  const kinds = SEARCHED_KINDS.map(() => "?").join(", ");
  return db.transaction(() => {
    // Rowids are not dense (tool calls are most rows), so the batch is
    // counted in rows of the kinds searched and the cursor moves to the last.
    const rows = db
      .prepare(
        `SELECT rowid AS rid, session_id, item_id,
                json_extract(data, '$.text') AS text
         FROM chat_items
         WHERE rowid > ? AND rowid <= ? AND kind IN (${kinds})
         ORDER BY rowid LIMIT ?`
      )
      .all(cursor, backfill_to, ...SEARCHED_KINDS, batch) as {
      rid: number;
      session_id: string;
      item_id: string;
      text: string | null;
    }[];
    const key = db.prepare(
      `SELECT id FROM chat_search_keys WHERE session_id = ? AND item_id = ?`
    );
    const del = db.prepare(`DELETE FROM chat_search WHERE rowid = ?`);
    const mk = db.prepare(
      `INSERT OR IGNORE INTO chat_search_keys (session_id, item_id) VALUES (?, ?)`
    );
    const put = db.prepare(
      `INSERT INTO chat_search (rowid, body) VALUES (?, ?)`
    );
    for (const r of rows) {
      if (!r.text) continue;
      const have = key.get(r.session_id, r.item_id) as
        { id: number } | undefined;
      if (have) del.run(have.id);
      else mk.run(r.session_id, r.item_id);
      const id = (key.get(r.session_id, r.item_id) as { id: number }).id;
      put.run(id, r.text);
    }
    const finished = rows.length < batch;
    const next = finished ? backfill_to : rows[rows.length - 1].rid;
    db.prepare(
      `UPDATE chat_search_state SET cursor = ?, done = ? WHERE id = 1`
    ).run(next, finished ? 1 : 0);
    return finished;
  })();
}

// 0..1 while the first index is being built; null once it is complete.
export function indexProgress(): number | null {
  const s = stateOf(getDb());
  if (!s || (s.done && s.version === SCHEMA_VERSION)) return null;
  return s.backfill_to ? Math.min(1, s.cursor / s.backfill_to) : 0;
}

let running = false;

// Runs batches until done, giving the event loop back between them, so a
// large history never holds up a request or the boot.
export function startConversationBackfill(): void {
  if (running) return;
  running = true;
  const t0 = Date.now();
  const tick = () => {
    try {
      if (backfillStep(getDb())) {
        running = false;
        console.log(`Conversation search index ready (${Date.now() - t0} ms)`);
        return;
      }
    } catch (error) {
      running = false;
      console.error("Indexing conversations for search failed:", error);
      return;
    }
    setImmediate(tick);
  };
  setImmediate(tick);
}
