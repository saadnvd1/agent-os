import type { Migration } from "../migration-types";

export default {
  id: 43,
  name: "scratch_project",
  up: (db) => {
    // Chats with no project work in a scratch folder rather than the home
    // directory. Sessions already made keep their own folders.
    db.prepare(
      `UPDATE projects SET name = 'Scratch', working_directory = '~/.agent-os/scratch'
         WHERE is_uncategorized = 1 AND name = 'Uncategorized' AND working_directory = '~'`
    ).run();
  },
} satisfies Migration;
