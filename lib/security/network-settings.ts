/**
 * Who AgentOS listens to, as switched in Settings → Devices. Environment
 * variables win over the stored setting so a deploy can pin them.
 */

import { getDb } from "@/lib/db";

export type NetworkSetting = "lan" | "require_pairing_on_tailnet";

const ENV: Record<NetworkSetting, string> = {
  lan: "AGENTOS_NETWORK",
  require_pairing_on_tailnet: "AGENTOS_REQUIRE_PAIRING_ON_TAILNET",
};

function fromEnv(key: NetworkSetting): boolean | null {
  const v = process.env[ENV[key]];
  if (v === undefined || v === "") return null;
  return key === "lan" ? v === "lan" : v === "1";
}

export function networkSetting(key: NetworkSetting): boolean {
  const env = fromEnv(key);
  if (env !== null) return env;
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value === "1";
}

/** Null when an environment variable pins it. */
export function networkSettingLocked(key: NetworkSetting): boolean {
  return fromEnv(key) !== null;
}

export function setNetworkSetting(key: NetworkSetting, on: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, on ? "1" : "0");
}

export const lanEnabled = () => networkSetting("lan");
