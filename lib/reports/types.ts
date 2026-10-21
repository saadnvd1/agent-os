// Plain-English health reports: types shared by the server, the browser and
// the native app (no Node modules here).

import type { TaskState } from "../tasks/state";

export const OPERATING_MODES = ["manual", "assisted", "autonomous"] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];
export const isMode = (v: unknown): v is OperatingMode =>
  typeof v === "string" && (OPERATING_MODES as readonly string[]).includes(v);

export const MODE_COPY: Record<
  OperatingMode,
  { label: string; blurb: string }
> = {
  manual: {
    label: "Manual",
    blurb: "The analyst recommends, you decide.",
  },
  assisted: {
    label: "Assisted",
    blurb: "The analyst drafts the next prompt, you approve it with one click.",
  },
  autonomous: {
    label: "Autonomous",
    blurb: "Agents iterate on their own, within the loop's safeguards.",
  },
};

export type ReportTrigger = "on-demand" | "cycle" | "end";
export type LineTone = "done" | "warn" | "blocked" | "next";
export type EvidenceKind =
  | "ci"
  | "test"
  | "review"
  | "diff"
  | "piece"
  | "accept"
  | "ask"
  | "state"
  | "log";
export type EvidenceStatus = "pass" | "fail" | "pending" | "info";

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  at: string;
  // The head it belongs to; stale when it differs from the current head.
  sha?: string;
  url?: string;
  href?: string;
  excerpt?: string;
}

export interface ReportLine {
  id: string;
  tone: LineTone;
  text: string;
  evidence: string[];
}

export interface EstimateItem {
  label: string;
  verified: boolean;
  evidence: string[];
}

export interface Estimate {
  done: number;
  total: number;
  basis: "acceptance" | "stages";
  items: EstimateItem[];
}

export type DraftStatus = "pending" | "sent" | "dismissed" | "superseded";

export interface NextPromptDraft {
  // The report row that holds it, or the analyst recommendation.
  source: "report" | "analyst";
  id: string;
  text: string;
  status: DraftStatus;
  // Analyst drafts send through the analyst link.
  linkId?: string;
}

export interface HealthReport {
  id: number;
  sessionId: string;
  workspaceId: string | null;
  head: string | null;
  trigger: ReportTrigger;
  createdAt: string;
  headline: string;
  state: TaskState;
  estimate: Estimate;
  lines: ReportLine[];
  recommendation: { text: string; evidence: string[] } | null;
  draft: NextPromptDraft | null;
  evidence: EvidenceRef[];
  // "template": the model failed, or every line it wrote was rejected.
  source: "model" | "template";
  // Model lines the validator rejected.
  dropped: number;
  model: string | null;
  costUsd: number | null;
  // Computed on read: the head moved since.
  stale: boolean;
}

export interface ReportSummary {
  sessionId: string;
  name: string;
  headline: string;
  state: TaskState;
  estimate: Pick<Estimate, "done" | "total" | "basis">;
  createdAt: string;
}

export interface ReportResponse {
  report: HealthReport | null;
  generating: boolean;
  mode: { mode: OperatingMode; source: "task" | "workspace" | "default" };
}

export const estimateLabel = (e: Pick<Estimate, "done" | "total" | "basis">) =>
  `Estimate · ${e.done} of ${e.total} ${
    e.basis === "acceptance"
      ? "acceptance items verified"
      : "delivery stages reached"
  }`;

export const estimatePercent = (e: Pick<Estimate, "done" | "total">) =>
  e.total ? Math.round((100 * e.done) / e.total) : 0;
