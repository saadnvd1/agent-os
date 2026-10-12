/**
 * Is Saad at this Mac right now? macOS reports how long the keyboard and
 * mouse have been still. A machine with no display (or any error) is away.
 */

import { execFile } from "child_process";
import { AT_MAC_MS } from "./policy";

/** Seconds idle from `ioreg -c IOHIDSystem` output, or null. */
export function parseHidIdle(text: string): number | null {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(text);
  return m ? Number(m[1]) / 1e9 : null;
}

type Run = () => Promise<string>;

const ioreg: Run = () =>
  new Promise((resolve, reject) =>
    execFile(
      "ioreg",
      ["-c", "IOHIDSystem"],
      { timeout: 2000, maxBuffer: 4 * 1024 * 1024 },
      (err, out) => (err ? reject(err) : resolve(out))
    )
  );

const CACHE_MS = 15_000;
let cached: { at: number; present: boolean } | null = null;

export async function atMac(
  opts: { platform?: string; run?: Run; now?: number } = {}
): Promise<boolean> {
  if ((opts.platform ?? process.platform) !== "darwin") return false;
  const now = opts.now ?? Date.now();
  if (cached && now - cached.at < CACHE_MS && !opts.run) return cached.present;
  let present = false;
  try {
    const idle = parseHidIdle(await (opts.run ?? ioreg)());
    present = idle !== null && idle * 1000 < AT_MAC_MS;
  } catch {
    present = false;
  }
  if (!opts.run) cached = { at: now, present };
  return present;
}
