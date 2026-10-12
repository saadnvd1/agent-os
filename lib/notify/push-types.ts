/**
 * Push notification types. Pure: no imports from the app, so the mobile app
 * can sync this file as is.
 *
 * The payload is a versioned envelope. v1 is generic and content-free (a fixed
 * title, a category word, a deep link). v2 is reserved for encrypted rich
 * text; an app that doesn't know a version shows the outer alert and opens
 * the fallback link, so v2 can ship without breaking older apps.
 */

export const PUSH_CATEGORIES = [
  "asks",
  "needs-you",
  "review",
  "ci",
  "merged",
  "agents",
  "digest",
  "system",
] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Maps onto the APNs interruption level. */
export type PushLevel = "time-sensitive" | "active" | "passive";

export const PUSH_PLATFORMS = ["ios", "android"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export const PUSH_ENVIRONMENTS = ["production", "sandbox"] as const;
export type PushEnvironment = (typeof PUSH_ENVIRONMENTS)[number];

export const PUSH_TITLE = "AgentOS";

/** Plain, content-free alert. */
export interface PushEnvelopeV1 {
  v: 1;
  /** Category, so the app can group and filter. */
  c: PushCategory;
  /** Fixed title. */
  t: typeof PUSH_TITLE;
  /** Category word from the registry, never event text. */
  b: string;
  /** Deep link, an app path like `/session/abc`. */
  l: string;
  /** Replaces an earlier alert with the same key. Opaque. */
  k: string;
  /** Interruption level. */
  p: PushLevel;
}

/** Reserved: encrypted rich text. Not produced yet. */
export interface PushEnvelopeV2 {
  v: 2;
  c: PushCategory;
  t: typeof PUSH_TITLE;
  /** Generic fallback body shown if the app can't decrypt. */
  b: string;
  l: string;
  k: string;
  p: PushLevel;
  /** Device id the key belongs to. */
  d: string;
  /** Base64url nonce and ciphertext. */
  n: string;
  x: string;
}

export type PushEnvelope = PushEnvelopeV1 | PushEnvelopeV2;

/** What a sender needs to say about an event. Ids only, never text. */
export interface PushEvent {
  category: PushCategory;
  /** Session, task or workspace id the link opens, when the category has one. */
  id?: string | null;
  /** Dedupe key, e.g. `ask:<id>` or `review:<task>:<sha>`. */
  key?: string | null;
}
