import type { Migration } from "../migration-types";

export default {
  id: 25,
  name: "add_stack_item_attempts",
  up: (db) => {
    // Starts retried after a transient failure, and holds the plan made
    // (an open blocker outside the stack) that a retry must not undo.
    db.exec(
      `ALTER TABLE stack_items ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`
    );
    db.exec(
      `ALTER TABLE stack_items ADD COLUMN held_outside INTEGER NOT NULL DEFAULT 0`
    );
  },
} satisfies Migration;
