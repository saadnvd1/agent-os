import type { Migration } from "../migration-types";

export default {
  id: 70,
  name: "chat_items_running",
  up: (db) => {
    // What is still running (tools, background tasks) is read on every
    // attach; the index holds only those rows, so it's a lookup, not a
    // scan that parses every tool output of a long conversation.
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_items_running ON chat_items(session_id, kind, seq)
         WHERE json_extract(data, '$.status') = 'running'`
    );
  },
} satisfies Migration;
