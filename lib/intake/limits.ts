import { INTAKE_LIMITS } from "../config/client-config-types";

export { INTAKE_LIMITS };

export const RATE = { max: 20, windowMs: 10 * 60_000 };
// Under the 5 MB an image may be once base64'd.
export const MAX_INLINE_IMAGE_BYTES = 3_750_000;
export const SHARE_EXCERPT_BYTES = 2048;
export const MAX_META_BYTES = 64 * 1024;
export const REPORT_INLINE_MAX = 1500;
// Multipart framing on top of the files themselves.
export const BODY_SLACK_BYTES = 1_000_000;

const hits = new Map<string, number[]>();

/** Counts a request against the device; false once it is over the cap. */
export function takeIntakeSlot(deviceId: string, now = Date.now()): boolean {
  const recent = (hits.get(deviceId) ?? []).filter(
    (t) => t > now - RATE.windowMs
  );
  if (recent.length >= RATE.max) {
    hits.set(deviceId, recent);
    return false;
  }
  recent.push(now);
  hits.set(deviceId, recent);
  return true;
}

export const resetIntakeRate = () => hits.clear();
