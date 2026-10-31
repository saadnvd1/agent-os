import { getSetting, putSetting } from "../settings-store";

// Whether this server shows the update banner, and the checks behind it.
// AGENTOS_UPDATE_BANNER=off pins it off, like the network settings.
const KEY = "updates.banner";
// Automatic updates: on unless switched off (an install that never touched
// the switch is on). AGENTOS_AUTO_UPDATE=off pins it off.
const AUTO_KEY = "updates.auto";
const IDLE_KEY = "updates.autoIdleMinutes";

type Env = Record<string, string | undefined>;

export const bannerLocked = (env: Env = process.env) =>
  env.AGENTOS_UPDATE_BANNER === "off";

export function bannerEnabled(env: Env = process.env): boolean {
  if (bannerLocked(env)) return false;
  return getSetting(KEY) !== "0";
}

export const setBannerEnabled = (on: boolean) =>
  putSetting(KEY, on ? "1" : "0");

export const autoLocked = (env: Env = process.env) =>
  env.AGENTOS_AUTO_UPDATE === "off";

type Get = (key: string) => string | null;

export function autoEnabled(
  env: Env = process.env,
  get: Get = getSetting
): boolean {
  if (autoLocked(env)) return false;
  return get(AUTO_KEY) !== "0";
}

export const setAutoEnabled = (on: boolean) =>
  putSetting(AUTO_KEY, on ? "1" : "0");

export { IDLE_MINUTES } from "./banner";
export const DEFAULT_IDLE_MINUTES = 10;

const minutes = (raw: string | null | undefined): number | null => {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 1 && n <= 24 * 60
    ? Math.round(n)
    : null;
};

export const idleMinutesLocked = (env: Env = process.env) =>
  minutes(env.AGENTOS_AUTO_UPDATE_IDLE_MIN) !== null;

/** How long everything must have been idle before an automatic update. */
export function idleMinutes(
  env: Env = process.env,
  get: Get = getSetting
): number {
  return (
    minutes(env.AGENTOS_AUTO_UPDATE_IDLE_MIN) ??
    minutes(get(IDLE_KEY)) ??
    DEFAULT_IDLE_MINUTES
  );
}

export const setIdleMinutes = (n: number) => putSetting(IDLE_KEY, String(n));

const envMinutes = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0
    ? n
    : fallback;
};

/** A release waits this long on the remote before an install takes it. */
export const soakMs = (env: Env = process.env) =>
  envMinutes(env.AGENTOS_AUTO_UPDATE_SOAK_MIN, 120) * 60_000;

/** After this long waiting for a quiet window, a short lull is enough. */
export const deadlineMs = (env: Env = process.env) =>
  envMinutes(env.AGENTOS_AUTO_UPDATE_DEADLINE_H, 72) * 60 * 60_000;

/** Free disk an update needs before it starts. */
export const minFreeBytes = (env: Env = process.env) =>
  envMinutes(env.AGENTOS_UPDATE_MIN_FREE_GB, 3) * 1024 ** 3;

export { getSetting, putSetting } from "../settings-store";
