// What a client sees of the orchestrator's asks. Client-safe (no database),
// so the web and the mobile app share it.

export const ASK_KINDS = [
  "decision",
  "public",
  "money",
  "irreversible",
  "credentials",
  "product",
  "gate",
  "brake",
  "passkey",
] as const;
export type AskKind = (typeof ASK_KINDS)[number];

export interface AskView {
  id: number;
  subject: string;
  kind: AskKind;
  title: string;
  why: string;
  detail: string;
  link: string | null;
  // The commit a gate ask is about (shown, so the approver sees what they approve).
  sha: string | null;
  // What Approve must send back, and whether it needs a passkey.
  binding: string;
  presence: boolean;
  createdAt: string;
}

export interface OrchestratorOverview {
  workspaceId: string;
  sessionId: string | null;
  paused: boolean;
  inReview: number;
  asks: AskView[];
}
