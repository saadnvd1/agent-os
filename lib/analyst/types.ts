import { z } from "zod";

// What the analyst says the coding agent should do next.
export const VERDICTS = ["continue", "done", "blocked", "needs_you"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const RECOMMENDATION_STATES = [
  "open",
  "sent",
  "dismissed",
  "superseded",
  "invalid",
] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

export const issueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2_000).default(""),
  where: z.string().trim().max(300).optional(),
});
export type Issue = z.infer<typeof issueSchema>;

export const MAX_ISSUES = 8;
export const MAX_PROMPT = 4_000;

// The fenced `agentos-review` block the analyst ends each review with.
export const reviewSchema = z.object({
  verdict: z.enum(VERDICTS),
  summary: z.string().trim().min(1).max(1_000),
  issues: z.array(issueSchema).max(MAX_ISSUES).default([]),
  prompt: z.string().trim().max(MAX_PROMPT).nullable().optional(),
});
export type Review = z.infer<typeof reviewSchema>;

// What a batch of the coding agent's turns did, worked out without a model.
export interface DigestSignals {
  turns: number;
  toolCalls: number;
  failedTools: number;
  // Test, build, typecheck or lint commands, and whether each passed.
  checks: { command: string; passed: boolean }[];
  filesChanged: string[];
  durationMs: number;
  costUsd: number;
  interrupted: boolean;
  errors: number;
  // Turns that ended without a single tool call.
  noToolTurns: number;
  // Fetched web content: a prompt built on it shouldn't be sent unseen.
  readWeb: boolean;
}

export interface AnalystLink {
  id: string;
  coderSessionId: string;
  analystSessionId: string;
  paused: boolean;
  // The coding agent's last turn_end the analyst has answered for.
  reviewedThrough: string | null;
  // A digest sent and not yet answered, the turn_end it runs to, and what
  // its turns did.
  pendingDigestId: string | null;
  pendingThrough: string | null;
  digestSignals: DigestSignals | null;
  createdAt: number;
  endedAt: number | null;
}

export interface Recommendation {
  id: string;
  linkId: string;
  analystItemId: string;
  coderThrough: string | null;
  verdict: Verdict | null;
  summary: string;
  issues: Issue[];
  signals: DigestSignals | null;
  prompt: string | null;
  state: RecommendationState;
  // Why it's invalid.
  error: string | null;
  sentText: string | null;
  sentItemId: string | null;
  edited: boolean;
  createdAt: number;
  decidedAt: number | null;
}

export interface PaneSession {
  id: string;
  name: string;
  agentType: string;
  model: string | null;
}

// A link as the panes and the native app read it.
export interface AnalystLinkView extends AnalystLink {
  coder: PaneSession;
  analyst: PaneSession;
  // The coding agent's latest finished turn, to tell a card it has moved on.
  coderLastTurn: string | null;
  recommendations: Recommendation[];
}

export class AnalystError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
  }
}

export const createLinkSchema = z
  .object({
    coderSessionId: z.string().min(1).optional(),
    newCoder: z
      .object({
        projectId: z.string().min(1),
        agentType: z.string().min(1),
        model: z.string().trim().min(1).optional(),
        prompt: z.string().trim().max(20_000).optional(),
        useWorktree: z.boolean().optional(),
      })
      .optional(),
    // The analyst's model for this pair, "provider/model"; else its role's.
    analystModel: z.string().trim().min(1).max(200).optional(),
    reviewLast: z.boolean().optional(),
  })
  .refine((b) => !!b.coderSessionId !== !!b.newCoder, {
    message: "Give coderSessionId or newCoder, not both",
  });
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

export const patchLinkSchema = z.object({ paused: z.boolean() });

export const sendSchema = z.object({
  text: z.string().trim().min(1).max(20_000).optional(),
});
