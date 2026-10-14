import type { Migration } from "../migration-types";

export default {
  id: 89,
  name: "passkeys_device_keys",
  up: (db) => {
    // A paired device's own approval key (Secure Enclave, Face ID) sits in
    // the passkeys table beside the browser passkeys: type 'device', bound
    // to the device that made it. Additive; existing rows read as webauthn.
    const columns = db.prepare(`PRAGMA table_info(passkeys)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "type"))
      db.exec(
        `ALTER TABLE passkeys ADD COLUMN type TEXT NOT NULL DEFAULT 'webauthn'`
      );
    if (!columns.some((c) => c.name === "device_id"))
      db.exec(`ALTER TABLE passkeys ADD COLUMN device_id TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_passkeys_device ON passkeys(device_id)`
    );
  },
} satisfies Migration;
