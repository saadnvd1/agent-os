import type { Migration } from "../migration-types";

export default {
  key: "20261018T1600_health_boot_deploys",
  up: (db) => {
    const cols = (
      db.prepare(`PRAGMA table_info(health_boots)`).all() as { name: string }[]
    ).map((c) => c.name);
    // 1 when autodeploy planned the restart that started this boot.
    if (!cols.includes("deploy"))
      db.exec(`ALTER TABLE health_boots ADD COLUMN deploy INTEGER`);
  },
} satisfies Migration;
