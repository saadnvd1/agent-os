import { getDb } from "@/lib/db";

// Whether this server shows the update banner, and the checks behind it.
// AGENTOS_UPDATE_BANNER=off pins it off, like the network settings.
const KEY = "updates.banner";

type Env = Record<string, string | undefined>;

export const bannerLocked = (env: Env = process.env) =>
  env.AGENTOS_UPDATE_BANNER === "off";

export function bannerEnabled(env: Env = process.env): boolean {
  if (bannerLocked(env)) return false;
  return getSetting(KEY) !== "0";
}

export const setBannerEnabled = (on: boolean) =>
  putSetting(KEY, on ? "1" : "0");

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
