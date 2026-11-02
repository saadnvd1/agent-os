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

import { hasUiEvidence } from "../tasks/ui-change";
import { MERGED_AS, mergePolicy } from "../tasks/merge-policy";
import { mergePR } from "../tasks/merge-pr";
import { attributionIn, codeReviewGate } from "../tasks/code-review";
import { run } from "../tasks/gh";
import { refundApproval, spendApproval } from "./ask-approvals";
import { resolveAsks } from "./asks";
import { clearStaleRunning, getCheck } from "./checks";
import { gateTarget, type ExternalPR } from "./external-pr";
import { holdingEscalations } from "./gates";
import { reviewWanted } from "./held-review";
import { addNote } from "./notes";
import { commitTime } from "./repo";
import { review, reviewAt, type ReviewOpts } from "./review";
import { gateVerdict, signOff, type Verdict } from "./signoff";
import { fullAccessOn } from "./full-access";
import { signOffTask } from "../tasks";
import { prFor } from "../tasks/session";
import { ciSettleIn } from "./task-state";
import { untrusted } from "./untrusted";
import { owner, Owner } from "../owner";

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
      const label = ext.labels.find((l) => BLOCKED_LABEL.test(l));
      return {
        checks: pr.checks,
        failing: pr.failing,
        failingUrl: pr.failingUrl,
        settleIn: ciSettleIn({
          workspaceId,
          taskId: ext.id,
          sha,
          checkCount: pr.checkCount ?? 0,
          committedAt: await commitTime(ext.repo, sha),
        }),
        mergeable: pr.mergeable,
        baseName: ext.base,
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
        // The same gate as a task's: the review of this exact head.
        codeReview: codeReviewGate({
          head: sha,
          attribution: attributionIn(ext.body) ?? null,
          review: (at) => getCheck(ext.id, at, "review"),
        }),
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
    throw new Error(`${Owner()}'s approval for ${ext.name} was already used`);
  const { method } = mergePolicy(ext.project);
  try {
    await mergePR({
      repo: ext.repo,
      number: ext.number,
      slug: ext.slug,
      method,
      head: verdict.sha,
    });
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
      ? `Merged ${ext.name} (not an AgentOS task, ${short(verdict.sha)}) on ${owner()}'s approval of that commit.`
      : `Merged ${ext.name} (not an AgentOS task, ${short(verdict.sha)}): CI green, review passed, in scope.`
  );
  return `Merged ${ext.name}: ${MERGED_AS[method]} at ${short(verdict.sha)}.`;
}

export async function reviewExternal(
  workspaceId: string,
  ext: ExternalPR,
  opts: ReviewOpts = {}
): Promise<string> {
  clearStaleRunning();
  const held = holdingEscalations(ext.id);
  if (
    held.length &&
    !(ext.pr.head && reviewWanted(workspaceId, ext.id, ext.pr.head))
  )
    return `${ext.name} is with ${owner()} (${held.map((h) => h.gate).join(", ")}); no review needed from you.`;
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
      pr: {
        number: ext.number,
        url: ext.url,
        uiEvidence: hasUiEvidence(ext.body),
      },
    },
    ext.pr.head,
    opts
  );
}

// sign_off: a task, or a PR no task owns in one of the workspace's repos.
export async function signOffTarget(
  workspaceId: string,
  ref: string,
  opts: { direct?: boolean; reason?: string } = {}
): Promise<string> {
  if (opts.direct) {
    if (!fullAccessOn(workspaceId))
      throw new Error(
        "A direct merge needs Orchestrator full access (Settings → Workspaces); merge through the gates"
      );
    if (!opts.reason?.trim()) throw new Error("A direct merge needs a reason");
    return signOffDirect(
      workspaceId,
      await gateTarget(workspaceId, ref),
      opts.reason
    );
  }
  const t = await gateTarget(workspaceId, ref);
  return t.kind === "external"
    ? signOffExternal(workspaceId, t.pr)
    : signOff(workspaceId, t.task.id);
}

// Orchestrator full access: merge now at the PR's current head, skipping the
// gates. The task's own non-gate checks still run (it's running, its PR is
// open and on its base, the head is the one merged); a task with Saad (the
// loop guard, no CI) is his to decide, not skipped here.
async function signOffDirect(
  workspaceId: string,
  t: Awaited<ReturnType<typeof gateTarget>>,
  reason: string
): Promise<string> {
  if (t.kind === "external") {
    const { pr, method } = {
      pr: t.pr,
      method: mergePolicy(t.pr.project).method,
    };
    if (!pr.pr.head) throw new Error(`${pr.name}'s head commit is unknown`);
    await mergePR({
      repo: pr.repo,
      number: pr.number,
      slug: pr.slug,
      method,
      head: pr.pr.head,
    });
    resolveAsks(workspaceId, pr.id, `${pr.name} merged directly`);
    addNote(
      workspaceId,
      `Merged ${pr.name} directly at ${short(pr.pr.head)}, skipping the gates: ${reason.trim()}`
    );
    return `Merged ${pr.name}: ${MERGED_AS[method]} at ${short(pr.pr.head)}, without the gates.`;
  }
  const task = t.task;
  if (holdingEscalations(task.id).length)
    throw new Error(
      `${task.name} is with ${owner()}; he signs it off or drops it, a direct merge doesn't go around that`
    );
  const pr = await prFor(task, true);
  if (!pr || pr.state !== "OPEN" || !pr.head)
    throw new Error(`${task.name} has no open PR`);
  const method = await signOffTask(task.id, { head: pr.head });
  addNote(
    workspaceId,
    `Merged ${task.name} directly (PR #${pr.number}, ${short(pr.head)}), skipping the gates: ${reason.trim()}`
  );
  return `Merged ${task.name}: PR #${pr.number} ${method ? MERGED_AS[method] : "merged"} at ${short(pr.head)}, without the gates.`;
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
