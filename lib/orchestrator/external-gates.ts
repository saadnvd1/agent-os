/**
 * The gates for a PR no AgentOS task owns (external-pr.ts), and what
 * sign_off and review call for any target. The same gates as a task's, on
 * its exact head: ci, the independent review, the rules on the diff, Saad's
 * approvals. What differs is what a task has and it doesn't: there's no
 * session to read for BLOCKED (a draft waits, a "blocked" label holds it),
 * no card and no stack. Its body may carry no "Code review" section (dispatch
 * writes its review up differently): then the orchestrator's own independent
 * review of that head stands in for it, and the gate says so. A section it
 * does carry is held to the same rules as a task's.
 */

import { attributionIn, codeReviewRefusal } from "../tasks/code-review";
import { run } from "../tasks/gh";
import { refundApproval, spendApproval } from "./ask-approvals";
import { resolveAsks } from "./asks";
import { clearStaleRunning, getCheck, type CheckRow } from "./checks";
import { gateTarget, type ExternalPR } from "./external-pr";
import { holdingEscalations } from "./gates";
import { addNote } from "./notes";
import { commitTime } from "./repo";
import { review, reviewAt, type ReviewOpts } from "./review";
import { gateVerdict, signOff, type Verdict } from "./signoff";
import { ciSettleIn } from "./task-state";
import { untrusted } from "./untrusted";

const short = (sha: string) => sha.slice(0, 7);

// Labels that say a PR isn't to be merged yet.
const BLOCKED_LABEL =
  /\bblocked\b|do[\s_-]*not[\s_-]*merge|\bwip\b|\bon[\s_-]*hold\b/i;
// What of the body the reviewer reads as the change's goal.
const GOAL_CAP = 8000;

const refsOf = (ext: ExternalPR) => ({
  base_branch: ext.base,
  branch_name: ext.branch,
});

// The code-review gate: a section in the body must cover the head like a
// task's; with none, the independent review of the head stands in.
export function externalCodeReview(
  ext: Pick<ExternalPR, "name" | "body" | "pr">,
  sha: string,
  review: CheckRow | null
): { refusal: string | null; wait: string | null } {
  const attribution = attributionIn(ext.body);
  if (attribution)
    return {
      refusal: `the PR body carries AI attribution (${attribution}): remove it with \`gh pr edit --body-file\``,
      wait: null,
    };
  const section = ext.pr.codeReview;
  if (section !== null)
    return {
      refusal: codeReviewRefusal(
        section,
        sha,
        null,
        `${ext.name}'s "Code review" section has to name ${short(sha)} on a "Reviewed:" line, or come out of the body`
      ),
      wait: null,
    };
  const none = `${ext.name}'s body has no "Code review" section; for a PR AgentOS didn't open, the orchestrator's own review of ${short(sha)} stands in for it`;
  if (review?.sha === sha && review.status === "pass")
    return { refusal: null, wait: null };
  return {
    refusal: null,
    wait:
      review?.sha === sha && review.status === "running"
        ? `${none}, and it's still running`
        : review?.sha === sha && review.status === "block"
          ? `${none}, and it has blocking findings`
          : `${none}: call review`,
  };
}

export async function judgeExternal(
  workspaceId: string,
  ext: ExternalPR,
  opts: { count?: boolean } = {}
): Promise<Verdict> {
  const { pr } = ext;
  if (!pr.head)
    return {
      ok: false,
      wait: false,
      text: `${ext.name}'s head commit is unknown`,
    };
  const sha = pr.head;
  return gateVerdict(
    workspaceId,
    {
      id: ext.id,
      name: ext.name,
      repo: ext.repo,
      refs: refsOf(ext),
      pr: { number: ext.number, url: ext.url },
      sha,
    },
    async () => {
      const review = getCheck(ext.id, sha, "review");
      const code = externalCodeReview(ext, sha, review);
      const label = ext.labels.find((l) => BLOCKED_LABEL.test(l));
      return {
        checks: pr.checks,
        failing: pr.failing,
        settleIn: ciSettleIn({
          workspaceId,
          taskId: ext.id,
          sha,
          checkCount: pr.checkCount ?? 0,
          committedAt: await commitTime(ext.repo, sha),
        }),
        review,
        blocked: null,
        waitingOn: null,
        prDraft: ext.draft ? `${ext.name} is a draft` : null,
        prBlocked: label
          ? `${ext.name} carries the label ${untrusted("GitHub", label)}`
          : null,
        fromCard: false,
        scope: null,
        stackRefusal: null,
        codeReviewRefusal: code.refusal,
        codeReviewWait: code.wait,
      };
    },
    opts
  );
}

async function mergedNow(ext: ExternalPR): Promise<boolean> {
  const out = await run(
    "gh",
    ["pr", "view", String(ext.number), "--repo", ext.slug, "--json", "state"],
    ext.repo,
    15000
  ).catch(() => "");
  return /"state"\s*:\s*"MERGED"/.test(out);
}

// Merges exactly the head the gates judged. An approval it spends is given
// back if GitHub refuses the merge.
export async function signOffExternal(
  workspaceId: string,
  ext: ExternalPR
): Promise<string> {
  const verdict = await judgeExternal(workspaceId, ext);
  if (!verdict.ok) throw new Error(verdict.text);
  if (verdict.approval && !spendApproval(verdict.approval))
    throw new Error(`Saad's approval for ${ext.name} was already used`);
  try {
    await run(
      "gh",
      [
        "pr",
        "merge",
        String(ext.number),
        "--repo",
        ext.slug,
        "--squash",
        "--match-head-commit",
        verdict.sha,
      ],
      ext.repo,
      120000
    );
  } catch (error) {
    if (verdict.approval && !(await mergedNow(ext)))
      refundApproval(verdict.approval);
    throw error;
  }
  resolveAsks(
    workspaceId,
    ext.id,
    `${ext.name} merged at ${short(verdict.sha)} by sign-off`
  );
  addNote(
    workspaceId,
    verdict.approval
      ? `Merged ${ext.name} (not an AgentOS task, ${short(verdict.sha)}) on Saad's approval of that commit.`
      : `Merged ${ext.name} (not an AgentOS task, ${short(verdict.sha)}): CI green, review passed, in scope.`
  );
  return `Merged ${ext.name}: squash-merged at ${short(verdict.sha)}.`;
}

export async function reviewExternal(
  workspaceId: string,
  ext: ExternalPR,
  opts: ReviewOpts = {}
): Promise<string> {
  clearStaleRunning();
  const held = holdingEscalations(ext.id);
  if (held.length)
    return `${ext.name} is with Saad (${held.map((h) => h.gate).join(", ")}); no review needed from you.`;
  if (!ext.pr.head) throw new Error(`${ext.name}'s head commit is unknown`);
  return reviewAt(
    workspaceId,
    {
      id: ext.id,
      name: ext.name,
      label: `PR ${ext.name}`,
      goal: `${ext.title}\n\n${ext.body}`.slice(0, GOAL_CAP),
      repo: ext.repo,
      refs: refsOf(ext),
      pr: { number: ext.number, url: ext.url },
    },
    ext.pr.head,
    opts
  );
}

// sign_off: a task, or a PR no task owns in one of the workspace's repos.
export async function signOffTarget(
  workspaceId: string,
  ref: string
): Promise<string> {
  const t = await gateTarget(workspaceId, ref);
  return t.kind === "external"
    ? signOffExternal(workspaceId, t.pr)
    : signOff(workspaceId, t.task.id);
}

// review: the same targets as sign_off.
export async function reviewTarget(
  workspaceId: string,
  ref: string,
  opts: ReviewOpts = {}
): Promise<string> {
  const t = await gateTarget(workspaceId, ref);
  return t.kind === "external"
    ? reviewExternal(workspaceId, t.pr, opts)
    : review(workspaceId, t.task.id, opts);
}
