import { getSetting, putSetting } from "../settings-store";

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

export { getSetting, putSetting } from "../settings-store";
