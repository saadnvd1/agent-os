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
}
