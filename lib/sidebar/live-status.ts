import {
  PR_STAGE_BUSY,
  PR_STAGE_SHORT,
  type PrStage,
  type PrStageName,
} from "../tasks/pr-stage";
import type { RowKindBadge } from "./row-badge";

export type LiveTone =
  | "blue"
  | "amber"
  | "red"
  | "green"
  | "purple"
  | "primary"
  | "muted";

export interface LivePart {
  text: string;
  tone: LiveTone;
  // Still moving on its own: the UI shows a spinner.
  busy?: boolean;
  // The plan badge: the UI draws its icon.
  plan?: RowKindBadge["kind"];
  tip?: string;
}

export const PR_STAGE_TONE: Record<PrStageName, LiveTone> = {
  merged: "purple",
  conflicts: "amber",
  "ci-failed": "red",
  "ci-running": "blue",
  "ci-settling": "blue",
  "review-running": "blue",
  "review-blocked": "red",
  waiting: "amber",
  armed: "green",
  open: "muted",
};

// What the row's second line says about the session right now, in order:
// "Compacting", then "Planning" or "Plan ready", then "PR CI". Empty when there is nothing to say.
export function liveParts(input: {
  compacting?: boolean;
  prStage?: PrStage;
  kindBadge?: RowKindBadge | null;
}): LivePart[] {
  const parts: LivePart[] = [];
  if (input.compacting)
    parts.push({ text: "Compacting", tone: "blue", busy: true });
  const k = input.kindBadge;
  if (k)
    parts.push({
      text: k.label,
      tone: k.kind === "planning" ? "blue" : "primary",
      plan: k.kind,
      tip: k.tip,
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
