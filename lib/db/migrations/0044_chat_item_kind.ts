import type { Migration } from "../migration-types";

export default {
  id: 44,
  name: "chat_item_kind",
  up: (db) => {
    // Items of one kind (a chat's background tasks, its sent messages)
    // read from an index, not by parsing every row of a long conversation.
    const columns = db.prepare(`PRAGMA table_xinfo(chat_items)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "kind"))
      db.exec(
        `ALTER TABLE chat_items ADD COLUMN kind TEXT
             GENERATED ALWAYS AS (json_extract(data, '$.kind')) VIRTUAL`
      );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_items_kind ON chat_items(session_id, kind, seq)`
    );
  },
} satisfies Migration;
