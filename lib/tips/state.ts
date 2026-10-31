import { getSetting, putSetting } from "@/lib/settings-store";
import type { Pinned } from "./pick";

const OFF = "tips.off";
const SEEN = "tips.seen";
const TODAY = "tips.today";

function json<T>(key: string, fallback: T): T {
  try {
    const raw = getSetting(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const tipsOff = (): boolean => getSetting(OFF) === "1";
export const setTipsOff = (off: boolean) => putSetting(OFF, off ? "1" : null);

/** Tip id -> the day it was last shown. */
export const readSeen = () => json<Record<string, string>>(SEEN, {});
export const writeSeen = (seen: Record<string, string>) =>
  putSetting(SEEN, JSON.stringify(seen));

export const readPinned = () => json<Pinned | null>(TODAY, null);
export const writePinned = (p: Pinned) => putSetting(TODAY, JSON.stringify(p));
