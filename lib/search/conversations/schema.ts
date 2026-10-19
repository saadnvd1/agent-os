import type Database from "better-sqlite3";

// Bump to rebuild the index from scratch (a different set of kinds, a new
// tokenizer); the next start's backfill does it.
export const SCHEMA_VERSION = 1;

// The item kinds whose text is searched. Tool calls and their output are
// most of the rows and mostly noise.
export const SEARCHED_KINDS = ["user", "assistant"] as const;

const KINDS_SQL = SEARCHED_KINDS.map((k) => `'${k}'`).join(", ");

// An item worth indexing: a searched kind with some text.
const eligible = `new.kind IN (${KINDS_SQL}) AND COALESCE(json_extract(new.data, '$.text'), '') <> ''`;

// The item's own key: the FTS rowid. chat_items has no integer primary key,
// so its rowids can be renumbered by a VACUUM.
const keyOf = (row: "new" | "old") =>
  `(SELECT id FROM chat_search_keys WHERE session_id = ${row}.session_id AND item_id = ${row}.item_id)`;

const reindexItem = `
  DELETE FROM chat_search WHERE rowid = ${keyOf("old")};
  DELETE FROM chat_search_keys WHERE session_id = old.session_id AND item_id = old.item_id;
  INSERT INTO chat_search_keys (session_id, item_id)
    SELECT new.session_id, new.item_id WHERE ${eligible};
  INSERT INTO chat_search (rowid, body)
    SELECT ${keyOf("new")}, json_extract(new.data, '$.text') WHERE ${eligible};`;

// Every writer of chat_items (the server, the chat worker, an import) is
// indexed by these, so no code path can forget.
export function createConversationSearch(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_search_keys (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      UNIQUE (session_id, item_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5(
      body,
      tokenize = "unicode61 remove_diacritics 2 tokenchars '_'",
      prefix = '2 3'
    );
    CREATE TABLE IF NOT EXISTS chat_search_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      backfill_to INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO chat_search_state (id, version, backfill_to, done)
      SELECT 1, ${SCHEMA_VERSION}, COALESCE(MAX(rowid), 0), MAX(rowid) IS NULL
      FROM chat_items;
    CREATE TRIGGER IF NOT EXISTS chat_search_ai AFTER INSERT ON chat_items
    BEGIN
      DELETE FROM chat_search WHERE rowid = ${keyOf("new")};
      INSERT OR IGNORE INTO chat_search_keys (session_id, item_id)
        SELECT new.session_id, new.item_id WHERE ${eligible};
      INSERT INTO chat_search (rowid, body)
        SELECT ${keyOf("new")}, json_extract(new.data, '$.text') WHERE ${eligible};
    END;
    CREATE TRIGGER IF NOT EXISTS chat_search_au AFTER UPDATE OF data ON chat_items
    BEGIN${reindexItem}
    END;
    CREATE TRIGGER IF NOT EXISTS chat_search_ad AFTER DELETE ON chat_items
    BEGIN
      DELETE FROM chat_search WHERE rowid = ${keyOf("old")};
      DELETE FROM chat_search_keys WHERE session_id = old.session_id AND item_id = old.item_id;
    END;
  `);
}
