// Read-only config a client renders with. Additive: a new field never bumps
// `v`; only a change that breaks an old reader does, and then the old field
// keeps being served beside the new one for a release. Synced to the native
// app, so it must stay pure: no imports.
export const CLIENT_CONFIG_VERSION = 1;

export type Tone = "muted" | "warning" | "primary" | "destructive" | "success";

export interface LabelTone {
  label: string;
  tone: Tone;
}

export interface AccessLevel {
  value: string;
  label: string;
  description: string;
}

// Keys are strings on purpose, so an older app can accept a state it doesn't
// know yet; each client narrows them through its own typed lookups.
export interface ClientConfig {
  v: number;
  server: { version: string | null; startedAt: string };
  access: { levels: AccessLevel[]; default: string };
  taskStates: Record<string, LabelTone>;
  runStatuses: Record<string, LabelTone>;
  runTriggers: Record<string, string>;
  features: ClientFeatures;
  intake: IntakeLimits;
  attachments: AttachmentConfig;
  voice: VoiceLimits;
  /** The owner's own name for text that refers to them; null until set. */
  ownerName: string | null;
}

// What a chat accepts, served from lib/attachments/policy.ts. Sizes in bytes.
export interface AttachmentConfig {
  max: number;
  maxBytes: number;
  maxTextBytes: number;
  maxImageBytes: number;
  pdfInlineBytes: number;
  types: {
    ext: string;
    mediaType: string;
    kind: "image" | "pdf" | "sheet" | "doc" | "text";
    note?: string;
  }[];
}

// Server kill switches for the phone's new sends.
export interface ClientFeatures {
  shakeToReport: boolean;
  shareIntake: boolean;
  voice: boolean;
}

export interface IntakeLimits {
  maxBytes: number;
  maxFiles: number;
  maxInlineImages: number;
  maxNoteChars: number;
  screenshotMaxEdge: number;
  logSeconds: number;
  logMaxLines: number;
}

export interface VoiceLimits {
  maxPhrases: number;
  holdMinMs: number;
  cancelSlidePx: number;
  speakMaxChars: number;
}

export const INTAKE_LIMITS: IntakeLimits = {
  // All files together; each is also held to its kind's limit in
  // lib/attachments/policy.ts (text up to maxTextBytes, so a big HAR fits).
  maxBytes: 100_000_000,
  maxFiles: 8,
  maxInlineImages: 2,
  maxNoteChars: 280,
  screenshotMaxEdge: 1600,
  logSeconds: 60,
  logMaxLines: 200,
};

export const VOICE_LIMITS: VoiceLimits = {
  maxPhrases: 100,
  holdMinMs: 250,
  cancelSlidePx: 80,
  speakMaxChars: 300,
};
