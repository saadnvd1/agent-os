import type { ListedDevice } from "@/lib/security/devices";

export const STALE_DAYS = 30;
// Fewer identical devices than this stay separate rows.
export const GROUP_MIN = 3;

export type DeviceEntry =
  | { kind: "device"; key: string; device: ListedDevice }
  // Devices with the same name and browser, none of them the one in use: a
  // simulator paired over and over, say. `device` is the most recently seen.
  | {
      kind: "group";
      key: string;
      device: ListedDevice;
      devices: ListedDevice[];
    };

const parseUtc = (s: string) => new Date(`${s.replace(" ", "T")}Z`).getTime();

const seenAt = (d: ListedDevice) =>
  d.last_seen_at ? parseUtc(d.last_seen_at) : parseUtc(d.created_at);

/**
 * The list the Devices page shows: identical devices folded into one row,
 * and the ones not used for a month set apart as `older`. The device in use
 * is never folded or aged out.
 */
export function groupDevices(
  devices: ListedDevice[],
  currentId: string | null | undefined,
  now = Date.now()
): { recent: DeviceEntry[]; older: DeviceEntry[] } {
  const buckets = new Map<string, ListedDevice[]>();
  const entries: DeviceEntry[] = [];
  for (const d of devices) {
    if (d.id === currentId) {
      entries.push({ kind: "device", key: d.id, device: d });
      continue;
    }
    const k = `${d.name}\u0000${d.user_agent ?? ""}`;
    buckets.set(k, [...(buckets.get(k) ?? []), d]);
  }
  for (const [k, list] of buckets) {
    const sorted = [...list].sort((a, b) => seenAt(b) - seenAt(a));
    if (sorted.length >= GROUP_MIN)
      entries.push({
        kind: "group",
        key: `group:${k}`,
        device: sorted[0],
        devices: sorted,
      });
    else
      for (const d of sorted)
        entries.push({ kind: "device", key: d.id, device: d });
  }
  entries.sort((a, b) => seenAt(b.device) - seenAt(a.device));
  const cutoff = now - STALE_DAYS * 86_400_000;
  const recent: DeviceEntry[] = [];
  const older: DeviceEntry[] = [];
  for (const e of entries) {
    const keep =
      (e.kind === "device" && e.device.id === currentId) ||
      seenAt(e.device) >= cutoff;
    (keep ? recent : older).push(e);
  }
  return { recent, older };
}
