import type { Migration } from "../migration-types";
import { cleanMachineName } from "../../peer/name";

export default {
  key: "20261020T1700_clean_connect_names",
  up: (db) => {
    // Connect machines linked before names were cleaned in full (lib/peer/name.ts)
    // keep the name the service gave them; clean those once.
    const rows = db
      .prepare(`SELECT id, name FROM hosts WHERE kind = 'connect'`)
      .all() as { id: string; name: string }[];
    const set = db.prepare(`UPDATE hosts SET name = ? WHERE id = ?`);
    for (const r of rows) {
      const clean = cleanMachineName(r.name);
      if (clean !== r.name) set.run(clean, r.id);
    }
  },
} satisfies Migration;
