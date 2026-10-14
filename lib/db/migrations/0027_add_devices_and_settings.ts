import type { Migration } from "../migration-types";

export default {
  id: 27,
  name: "add_devices_and_settings",
  up: (db) => {
    // Paired phones, tablets and laptops. Only a hash of each token is kept.
    db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT,
          last_address TEXT,
          revoked_at TEXT
        )
      `);
    // Small app-wide switches (Wi-Fi access, pairing on the tailnet).
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
  },
} satisfies Migration;
