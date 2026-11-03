// What a client sees of the orchestrator's asks. Client-safe (no database),
// so any client (the web, an API client) can import it.

import type { PendingCardView } from "../learning-cards/types";

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

// A question the orchestrator put to Saad in chat, open until answered.
export interface QuestionView {
  id: number;
  text: string;
  // The task it is about, when it names one.
  task: string | null;
  taskName: string | null;
  createdAt: string;
}

export interface OrchestratorOverview {
  workspaceId: string;
  sessionId: string | null;
  paused: boolean;
  inReview: number;
  asks: AskView[];
  questions: QuestionView[];
  // Keys (ask:<id>, question:<id>) he hid from the Needs-you strip.
  dismissed: string[];
  // Learning cards waiting on him; none while the experiment is off.
  cards: PendingCardView[];
}
