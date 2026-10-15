// A PR the loop guard sent to Saad is still judged: the commit his ask
// names gets the independent review it would have had, and the ask shows
// CI and that review, so he never approves blind. His approval still
// merges that commit once (signoff.ts); the verdict informs it, nothing more.

import { getCheck, type CheckRow } from "./checks";
import { EXTERNAL_PREFIX, openAsks, setAskVerdict, type AskRow } from "./asks";
import { reviewTarget } from "./external-gates";
import type { SessionFacts } from "./facts";
import { holdingEscalations } from "./gates";
import { APPROVAL_GATES } from "./merge-approvals";
import { untrusted } from "./untrusted";
import type { TaskPR } from "../tasks/state";

export interface AskVerdictDeps {
  review: (workspaceId: string, ref: string) => Promise<unknown>;
}

const defaults: AskVerdictDeps = {
  review: (w, ref) => reviewTarget(w, ref),
};

// Asks whose review was started here, so one that couldn't start (the head
// moved, gh failed) isn't retried every pass.
const started = new Set<string>();
const STARTED_MAX = 1000;

const workId = (subject: string) =>
  subject.startsWith(EXTERNAL_PREFIX)
    ? subject
    : subject.startsWith("task:")
      ? subject.slice("task:".length)
      : null;

// Held by the loop guard, not only by an approval Saad asked to give.
const loopHeld = (id: string) =>
  holdingEscalations(id).some((h) => !APPROVAL_GATES.includes(h.gate));

export async function followAskVerdicts(
  workspaceId: string,
  facts: SessionFacts[],
  deps: AskVerdictDeps = defaults
): Promise<void> {
  for (const ask of openAsks(workspaceId)) {
    const id = workId(ask.subject);
    if (ask.kind !== "gate" || !ask.sha || !id || !loopHeld(id)) continue;
    try {
      await follow(
        workspaceId,
        ask as AskRow & { sha: string },
        id,
        facts,
        deps
      );
    } catch (error) {
      console.error(`Judging ask ${ask.id}'s commit:`, error);
    }
  }
}

async function follow(
  workspaceId: string,
  ask: AskRow & { sha: string },
  id: string,
  facts: SessionFacts[],
  deps: AskVerdictDeps
): Promise<void> {
  const key = `${ask.id}:${ask.sha}`;
  if (!getCheck(id, ask.sha, "review") && !started.has(key)) {
    if (started.size >= STARTED_MAX) started.clear();
    started.add(key);
    await deps.review(workspaceId, id);
  }
  const pr = facts.find((f) => f.id === id)?.task?.pr;
  setAskVerdict(
    ask.id,
    ask.sha,
    verdictText(
      pr?.head === ask.sha ? pr : null,
      getCheck(id, ask.sha, "review")
    )
  );
}

const REVIEW_MAX = 600;

export function verdictText(
  pr: Pick<TaskPR, "checks" | "failing"> | null,
  review: CheckRow | null
): string {
  const ci = !pr
    ? null
    : pr.checks === "pass"
      ? "CI passed."
      : pr.checks === "fail"
        ? `CI failed${pr.failing ? ` (${untrusted("CI", pr.failing)})` : ""}.`
        : pr.checks === "pending"
          ? "CI is running."
          : "No CI checks.";
  const detail = (review?.detail ?? "").slice(0, REVIEW_MAX);
  const said = !review
    ? "Independent review: not started yet."
    : review.status === "running"
      ? "Independent review: running."
      : review.status === "error"
        ? `Independent review: couldn't run (${detail}).`
        : review.status === "pass"
          ? "Independent review: passed."
          : `Independent review: blocking findings.\n${untrusted("reviewer", detail)}`;
  return [ci, said].filter(Boolean).join(" ");
}
