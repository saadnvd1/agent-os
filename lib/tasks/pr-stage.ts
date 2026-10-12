// Where a task's PR is in the gates, as one word for the UI. Pure: the
// inputs are what AgentOS already tracks for the PR (tasks/state.ts,
// orchestrator/checks.ts), so nothing here asks GitHub or a model.

export const PR_STAGES = [
  "merged",
  "conflicts",
  "ci-failed",
  "ci-running",
  "ci-settling",
  "review-running",
  "review-blocked",
  "waiting",
  "armed",
  "open",
] as const;

export type PrStageName = (typeof PR_STAGES)[number];

export interface PrStage {
  stage: PrStageName;
  number: number;
  url: string;
  // The PR's head, 7 characters.
  sha?: string;
}

export interface PrStageInput {
  pr: {
    number: number;
    url: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    checks: "pass" | "fail" | "pending" | "none";
    head?: string;
    mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  } | null;
  // Seconds until CI on the head counts as settled (0 or unset: settled).
  settleIn?: number;
  // The newest review of the head commit.
  review?: "running" | "pass" | "block" | "error" | null;
  // Escalated to Saad, or an ask of his open on it.
  held?: boolean;
  armed?: boolean;
}

// In priority order: the first that applies wins, so a conflict hides the
// CI behind it and a failed CI hides a review that would be moot.
export function derivePrStage(input: PrStageInput): PrStage | null {
  const { pr } = input;
  if (!pr || pr.state === "CLOSED") return null;
  const base = {
    number: pr.number,
    url: pr.url,
    ...(pr.head && { sha: pr.head.slice(0, 7) }),
  };
  const at = (stage: PrStageName): PrStage => ({ stage, ...base });
  if (pr.state === "MERGED") return at("merged");
  if (pr.mergeable === "CONFLICTING") return at("conflicts");
  if (pr.checks === "fail") return at("ci-failed");
  if (pr.checks === "pending") return at("ci-running");
  if (pr.checks === "pass" && (input.settleIn ?? 0) > 0)
    return at("ci-settling");
  if (input.review === "running") return at("review-running");
  if (input.review === "block") return at("review-blocked");
  if (input.held) return at("waiting");
  if (input.armed) return at("armed");
  return at("open");
}

// Stages still moving on their own: the badge spins for these.
export const PR_STAGE_BUSY: ReadonlySet<PrStageName> = new Set([
  "conflicts",
  "ci-running",
  "ci-settling",
  "review-running",
]);

export const PR_STAGE_LABEL: Record<PrStageName, string> = {
  merged: "merged",
  conflicts: "rebasing",
  "ci-failed": "CI failed",
  "ci-running": "CI running",
  "ci-settling": "CI settling",
  "review-running": "reviewing",
  "review-blocked": "review blocked",
  waiting: "waiting on you",
  armed: "armed",
  open: "open",
};

export const prStageText = (s: Pick<PrStage, "stage" | "number">) =>
  `PR #${s.number} · ${PR_STAGE_LABEL[s.stage]}`;
