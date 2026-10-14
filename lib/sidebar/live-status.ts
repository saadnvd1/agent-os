import {
  PR_STAGE_BUSY,
  PR_STAGE_SHORT,
  type PrStage,
  type PrStageName,
} from "../tasks/pr-stage";
import type { StatusBadge } from "./row-badge";

export type LiveTone = "amber" | "red" | "green" | "primary" | "muted";

export interface LivePart {
  text: string;
  tone: LiveTone;
  // Still moving on its own: the UI shows a spinner.
  busy?: boolean;
  // A status badge (need, stalled, plan step): drawn as a pill, with an icon
  // for the plan kinds.
  badge?: StatusBadge["kind"];
  tip?: string;
}

export const BADGE_TONE: Record<StatusBadge["kind"], LiveTone> = {
  need: "amber",
  failed: "red",
  stalled: "amber",
  starting: "muted",
  planning: "muted",
  "plan-ready": "primary",
};

export const PR_STAGE_TONE: Record<PrStageName, LiveTone> = {
  merged: "green",
  conflicts: "amber",
  "ci-failed": "red",
  "ci-running": "muted",
  "ci-settling": "muted",
  "review-running": "muted",
  "review-blocked": "red",
  waiting: "amber",
  armed: "green",
  open: "muted",
};

// What the row's second line says about the session right now, in order:
// "Compacting", then a status badge (Needs you, Stalled, Planning, Plan
// ready), then "PR CI". Empty when there is nothing to say.
export function liveParts(input: {
  compacting?: boolean;
  prStage?: PrStage;
  badge?: StatusBadge | null;
}): LivePart[] {
  const parts: LivePart[] = [];
  if (input.compacting)
    parts.push({ text: "Compacting", tone: "muted", busy: true });
  const b = input.badge;
  if (b)
    parts.push({
      text: b.label,
      tone: BADGE_TONE[b.kind],
      badge: b.kind,
      tip: b.tip,
    });
  const s = input.prStage;
  if (s) {
    const word = PR_STAGE_SHORT[s.stage];
    parts.push({
      text: s.stage === "open" ? "PR" : `PR ${word}`,
      tone: PR_STAGE_TONE[s.stage],
      busy: PR_STAGE_BUSY.has(s.stage),
    });
  }
  return parts;
}

export const liveText = (parts: LivePart[]) =>
  parts.map((p) => p.text).join(" · ");
