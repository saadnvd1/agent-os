import type { Migration } from "../migration-types";

export default {
  key: "20261018T2100_orch_full_access",
  up: (db) => {
    // Whether the workspace's orchestrator runs with its shell and file
    // guards off (orchestrator/full-access.ts). On by default. Additive.
    const cols = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "orch_full_access"))
      db.exec(
        `ALTER TABLE workspaces ADD COLUMN orch_full_access INTEGER NOT NULL DEFAULT 1`
      );
  },
} satisfies Migration;
