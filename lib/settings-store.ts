import { getDb } from "@/lib/db";

// The settings table: a key and a string, shared by every feature.
export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function putSetting(key: string, value: string | null): void {
  if (value === null) {
    getDb().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}
