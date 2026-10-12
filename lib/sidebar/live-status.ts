import {
  PR_STAGE_BUSY,
  PR_STAGE_SHORT,
  type PrStage,
  type PrStageName,
} from "../tasks/pr-stage";

export type LiveTone = "blue" | "amber" | "red" | "green" | "purple" | "muted";

export interface LivePart {
  text: string;
  tone: LiveTone;
  // Still moving on its own: the UI shows a spinner.
  busy?: boolean;
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
// "Compacting", then "PR CI". Empty when there is nothing to say.
export function liveParts(input: {
  compacting?: boolean;
  prStage?: PrStage;
}): LivePart[] {
  const parts: LivePart[] = [];
  if (input.compacting)
    parts.push({ text: "Compacting", tone: "blue", busy: true });
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
