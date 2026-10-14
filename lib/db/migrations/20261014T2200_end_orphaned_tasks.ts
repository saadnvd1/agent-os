import type { Migration } from "../migration-types";

export default {
  key: "20261014T2200_end_orphaned_tasks",
  up: (db) => {
    // A background task still "running" whose tool call was stopped or
    // errored has no job behind it. Settles the rows already stuck.
    db.exec(`
      UPDATE chat_items
      SET data = json_set(data, '$.status', 'stopped',
                          '$.endedAt', CAST(strftime('%s','now') AS INTEGER) * 1000,
                          '$.summary', COALESCE(json_extract(data, '$.summary'),
                                                'Its agent ended before this finished'))
      WHERE kind = 'task' AND json_extract(data, '$.status') = 'running'
        AND EXISTS (
          SELECT 1 FROM chat_items t
          WHERE t.session_id = chat_items.session_id
            AND t.item_id = json_extract(chat_items.data, '$.toolUseId')
            AND t.kind = 'tool'
            AND json_extract(t.data, '$.status') IN ('stopped', 'error'))
    `);
  },
} satisfies Migration;
