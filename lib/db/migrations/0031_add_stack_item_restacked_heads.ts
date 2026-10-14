import type { Migration } from "../migration-types";

export default {
  id: 31,
  name: "add_stack_item_restacked_heads",
  up: (db) => {
    // A branch AgentOS rebased itself: its head before (the commit the
    // task's code review covered) and after (the head AgentOS pushed).
    // Each column checked, so a run cut off between the two can't be
    // marked applied with one missing.
    const cols = new Set(
      (
        db.prepare(`PRAGMA table_info(stack_items)`).all() as {
          name: string;
        }[]
      ).map((c) => c.name)
    );
    for (const col of ["restacked_from", "restacked_to"])
      if (!cols.has(col))
        db.exec(`ALTER TABLE stack_items ADD COLUMN ${col} TEXT`);
  },
} satisfies Migration;
