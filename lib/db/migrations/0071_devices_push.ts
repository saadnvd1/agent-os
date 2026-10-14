import type { Migration } from "../migration-types";

export default {
  id: 71,
  name: "devices_push",
  up: (db) => {
    // Push belongs to a paired device, so revoking the device clears it.
    // push_categories is a JSON array; NULL means the defaults.
    // Each column checked, so a run cut off part way can be run again.
    const have = new Set(
      (
        db.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
      ).map((c) => c.name)
    );
    for (const col of [
      "push_token",
      "push_platform",
      "push_environment",
      "push_categories",
      "push_updated_at",
      "push_last_error",
    ])
      if (!have.has(col)) db.exec(`ALTER TABLE devices ADD COLUMN ${col} TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token)
         WHERE push_token IS NOT NULL`
    );
  },
} satisfies Migration;
