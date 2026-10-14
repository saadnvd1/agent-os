import type { Migration } from "../migration-types";

export default {
  id: 12,
  name: "add_initial_prompt_to_projects",
  up: (db) => {
    db.exec(`ALTER TABLE projects ADD COLUMN initial_prompt TEXT`);
  },
} satisfies Migration;
