/**
 * `sign_off` and `land`: merges only through the gates, pinned to the
 * commit that was judged. With merge approvals on (merge-approvals.ts),
 * anything touching CI config, build and hook scripts, agent config, deploys
 * or secrets handling goes to Saad whatever the gates say. A repository with
 * no CI (decided from the repository, never from one head with no checks)
 * and a gate failing on two different commits go to him either way. Once a
 * task is with Saad the orchestrator doesn't merge it; he signs it off or drops it.
 */

import { MERGED_AS, type MergeMethod } from "../tasks/merge-policy";
import { prFor } from "../tasks/session";
import { codeReviewGate, signOffTask } from "../tasks";
import { signOffRefusal } from "../stacks/guard";
import { getStack, landInBackground } from "../stacks";
import { LAND_DEFAULTS } from "../stacks/land";
import { db, stackQueries, type Session } from "../db";
import { getCheck } from "./checks";
import { isQuick, quickCodeReview } from "./quick";
import {
  addedLines,
  changedFiles,
  fullDiff,
  ruleBreaks,
  sensitiveFiles,
} from "./diff";
import { countFailure, escalate } from "./escalate";
import {
  ciGate,
  evaluateGates,
  holdingEscalations,
  type GateInput,
} from "./gates";
import { addNote } from "./notes";
import { latestApproval, refundApproval, spendApproval } from "./ask-approvals";
import { workSubject } from "./asks";
import { carryApproval } from "./approval-carry";
import { heldVerdict } from "./held";
import { mergeApprovalsOn } from "./merge-approvals";
import { isPaused } from "./pause";
import { commitTime, fetchRefs, repoOf } from "./repo";
import { repoHasCI } from "./repo-ci";
import { DIFF_CAP, review } from "./review";
import { workspaceStack, workspaceTask } from "./targets";
import { ciSettleIn, waitingState } from "./task-state";

const short = (sha: string) => sha.slice(0, 7);

// The heads AgentOS's own restack, or its automatic rebase onto the base,
// moved the task's branch between.
export function restackedOf(task: Session) {
  const item = stackQueries.itemForSession(db, task.id);
  if (item) return { from: item.restacked_from, to: item.restacked_to };
  return task.rebased_to
    ? { from: task.rebased_from ?? null, to: task.rebased_to }
    : null;
}

// `approval`: Saad approved this merge on his asks list, for this commit.
export type Verdict =
  | { ok: true; sha: string; pr: number; approval?: number }
  | { ok: false; wait: boolean; text: string };

// Whether the task may merge now, and at which commit. Landing merges a
// stack bottom-up, so there a parent not merged yet is fine. `count`: a
// failure counts toward going to Saad; off when a person asked (done from
// the UI or the CLI), so a cleanup sweep run twice doesn't escalate.
export async function judge(
  workspaceId: string,
  task: Session,
  landing = false,
  opts: { count?: boolean } = {}
): Promise<Verdict> {
  if (task.task_status !== "running")
    return {
      ok: false,
      wait: false,
      text: `${task.name} is already ${task.task_status}`,
    };
  const pr = await prFor(task, true);
  if (!pr || pr.state !== "OPEN" || !pr.head)
    return { ok: false, wait: false, text: `${task.name} has no open PR` };
  // prFor records a retarget to the default branch or the stack parent's
  // branch; any other base would merge somewhere nobody chose, judged
  // against a branch the task picked.
  if (pr.base && pr.base !== task.base_branch)
    return {
      ok: false,
      wait: false,
      text: `${task.name}'s PR #${pr.number} targets ${pr.base}, not its base ${task.base_branch ?? "(none)"}: retarget it to ${task.base_branch ?? "the default branch"}`,
    };
  const sha = pr.head;
  const repo = repoOf(task);
  // A PR quick_pr opened (by the row AgentOS wrote, never the body): its
  // code review is the independent review of this head, and until that
  // passes it waits, before any gate is judged or counted.
  const quick = isQuick(task)
    ? quickCodeReview(
        sha,
        getCheck(task.id, sha, "review"),
        restackedOf(task)?.to === sha
      )
    : null;
  // Saad's approval of this head stands in for that review (gateVerdict).
  if (
    quick?.wait &&
    latestApproval(workspaceId, workSubject(task.id))?.sha !== sha
  )
    return {
      ok: false,
      wait: true,
      text: `${task.name} (PR #${pr.number} at ${short(sha)}) can't merge yet: ${quick.wait}`,
    };
  return gateVerdict(
    workspaceId,
    { id: task.id, name: task.name, repo, refs: task, pr, sha },
    async () => ({
      checks: pr.checks,
      failing: pr.failing,
      settleIn: ciSettleIn({
        workspaceId,
        taskId: task.id,
        sha,
        checkCount: pr.checkCount ?? 0,
        committedAt: await commitTime(repo, sha),
      }),
      mergeable: pr.mergeable,
      baseName: pr.base ?? task.base_branch,
      review: getCheck(task.id, sha, "review"),
      ...(await waitingState(task)),
      fromCard: !!task.lh_card_id,
      scope: getCheck(task.id, sha, "scope"),
      stackRefusal: landing ? null : signOffRefusal(task.id),
      codeReview: (() => {
        const gate = codeReviewGate({
          head: sha,
          attribution: pr.attribution,
          review: (at) => getCheck(task.id, at, "review"),
          restacked: restackedOf(task),
        });
        // A quick change keeps the body checks (attribution, unreadable);
        // its wait on the review was judged above.
        return quick ? { refusal: gate.refusal, wait: null } : gate;
      })(),
    }),
    opts
  );
}

// What's being merged: a task's PR, or a PR no task owns. `id` keys its
// checks, failures and asks.
export interface GateWork {
  id: string;
  name: string;
  repo: string;
  refs: Pick<Session, "base_branch" | "branch_name">;
  pr: { number: number; url: string };
  sha: string;
}

// The gates on one exact head, the same for every PR: Saad's hold, the
// rules on the diff, then each gate.
export async function gateVerdict(
  workspaceId: string,
  work: GateWork,
  inputs: () => Promise<Omit<GateInput, "sha" | "ruleBreaks">>,
  opts: { count?: boolean } = {}
): Promise<Verdict> {
  const no = (text: string, wait = false): Verdict => ({
    ok: false,
    wait,
    text,
  });
  const { pr, sha, repo } = work;
  const held = holdingEscalations(work.id);
  // Saad approved merging this exact commit: held or not, it merges once,
  // without a review or any other gate approval stands in for. Approval
  // doesn't cover what's left: an AI-attributed body, failing CI (running
  // CI is a wait), and, on an ask the orchestrator raised or a task the
  // gates don't hold, a stack parent not merged yet. On a held task, an
  // approval of an earlier commit goes back to him (heldVerdict).
  let approval = latestApproval(workspaceId, workSubject(work.id));
  // The head moved since he approved: his approval follows it when the PR's
  // own patch is unchanged (a rebase), else the re-ask says what changed.
  let moved: string | undefined;
  if (approval?.sha && approval.sha !== sha) {
    const carried = await carryApproval(
      workspaceId,
      work,
      { ...approval, sha: approval.sha },
      sha
    );
    if (carried.approval) approval = carried.approval;
    else moved = carried.note;
  }
  if (approval?.sha === sha) {
    const i = await inputs();
    const approved = `${work.name} (PR #${pr.number} at ${short(sha)}): Saad approved this commit, but`;
    const stack =
      approval.raised_by === "orchestrator" || !held.length
        ? i.stackRefusal
        : null;
    const refusal = i.codeReview.refusal ?? stack;
    if (refusal) return no(`${approved} ${refusal}`);
    const ci = ciGate({ sha, ...i, repoCI: await repoCIFor(repo, work, i) });
    if (ci.state === "fail") return no(`${approved} ${ci.reason}`);
    if (ci.state === "wait") return no(`${approved} ${ci.reason}`, true);
    // "escalate" is a repository with no CI: Saad is who that goes to.
    return { ok: true, sha, pr: pr.number, approval: approval.id };
  }
  if (held.length)
    return heldVerdict(workspaceId, work, held, pr.url, sha, pr.number, moved);

  const base = await fetchRefs(repo, work.refs);
  const files = await changedFiles(repo, base, sha);
  const sensitive = mergeApprovalsOn() ? sensitiveFiles(files) : [];
  if (sensitive.length) {
    const what = sensitive.map((s) => `${s.path} (${s.why})`).join(", ");
    const why = `PR #${pr.number} at ${short(sha)} touches ${what}`;
    return no(escalate(workspaceId, work, "sensitive", why, pr.url, sha));
  }
  // Here too, not only in the review: one reviewed in parts while approvals
  // were off goes to Saad once they're on.
  if (mergeApprovalsOn()) {
    const size = (await fullDiff(repo, base, sha)).length;
    if (size > DIFF_CAP) {
      const why = `PR #${pr.number}'s diff at ${short(sha)} is ${size} characters, too big to review whole`;
      return no(escalate(workspaceId, work, "size", why, pr.url, sha));
    }
  }

  const ruled = ruleBreaks(files, await addedLines(repo, base, sha));
  const live = await inputs();
  const repoCI = await repoCIFor(repo, base, live);
  const outcomes = evaluateGates({ sha, ruleBreaks: ruled, ...live, repoCI });
  const head = `${work.name} (PR #${pr.number} at ${short(sha)}) can't merge:`;
  const toSaad = outcomes.find((o) => o.state === "escalate");
  if (toSaad)
    return no(
      `${head}\n- ${escalate(workspaceId, work, toSaad.gate, toSaad.reason!, pr.url, sha)}`
    );
  const failed = outcomes.filter((o) => o.state === "fail");
  const waiting = outcomes.filter((o) => o.state === "wait");
  if (!failed.length && !waiting.length)
    return { ok: true, sha, pr: pr.number };
  const lines = [
    ...failed.map((o) =>
      opts.count === false
        ? `- ${o.gate} failed: ${o.reason}`
        : countFailure(workspaceId, work, o, pr.url, sha).line
    ),
    ...waiting.map((o) => `- ${o.gate}: not yet, ${o.reason}`),
  ];
  return no(`${head}\n${lines.join("\n")}`, !failed.length);
}

// Asked only when it can change the answer: a head with no checks that
// isn't settling or conflicting.
async function repoCIFor(
  repo: string,
  base: string | GateWork,
  i: Pick<GateInput, "checks" | "settleIn" | "mergeable">
) {
  if (i.checks !== "none" || i.settleIn !== 0 || i.mergeable === "CONFLICTING")
    return undefined;
  if (typeof base !== "string") {
    try {
      base = await fetchRefs(repo, base.refs);
    } catch {
      return undefined;
    }
  }
  return repoHasCI(repo, base);
}

export async function signOff(
  workspaceId: string,
  ref: string
): Promise<string> {
  const task = workspaceTask(workspaceId, ref);
  const verdict = await judge(workspaceId, task);
  if (!verdict.ok) throw new Error(verdict.text);
  return mergeJudged(workspaceId, task, verdict);
}

// Merges exactly the commit a passing verdict judged.
export async function mergeJudged(
  workspaceId: string,
  task: Session,
  verdict: Extract<Verdict, { ok: true }>,
  opts: { wait?: boolean } = {}
): Promise<string> {
  if (verdict.approval && !spendApproval(verdict.approval))
    throw new Error(`Saad's approval for ${task.name} was already used`);
  let method: MergeMethod | null = null;
  await refundIfRefused(task.id, verdict.approval, async () => {
    method = await signOffTask(task.id, { head: verdict.sha, wait: opts.wait });
  });
  addNote(
    workspaceId,
    verdict.approval
      ? `Merged ${task.name} (PR #${verdict.pr}, ${short(verdict.sha)}) on Saad's approval of that commit.`
      : `Merged ${task.name} (PR #${verdict.pr}, ${short(verdict.sha)}): CI green, review passed, in scope.`
  );
  return `Merged ${task.name}: PR #${verdict.pr} ${method ? MERGED_AS[method] : "merged"} at ${short(verdict.sha)}.`;
}

// An approval is claimed before the merge, so two merges can't both use it,
// and given back when GitHub or the checks refuse that merge: it is spent
// only on a merge that happened.
export async function refundIfRefused(
  taskId: string,
  approval: number | undefined,
  merge: () => Promise<void>
): Promise<void> {
  try {
    await merge();
  } catch (e) {
    const merged = db
      .prepare(`SELECT 1 FROM sessions WHERE id = ? AND task_status = 'merged'`)
      .get(taskId);
    if (approval && !merged) refundApproval(approval);
    throw e;
  }
}

// Asked before each merge of a land: the whole judgement again on the
// item's head as it is then (a restack moves it), merging only that
// commit. A head with no review yet gets one started, and the land waits.
export function landGate(
  workspaceId: string,
  claimed = new Map<string, number>()
) {
  return async (
    sessionId: string
  ): Promise<{ head: string } | { wait: string } | { stop: string }> => {
    if (isPaused(workspaceId)) return { wait: "the orchestrator is paused" };
    const task = workspaceTask(workspaceId, sessionId);
    const verdict = await judge(workspaceId, task, true);
    if (verdict.ok && verdict.approval) {
      if (!spendApproval(verdict.approval))
        return { stop: `Saad's approval for ${task.name} was already used` };
      claimed.set(sessionId, verdict.approval);
    }
    if (verdict.ok) return { head: verdict.sha };
    if (!verdict.wait) return { stop: verdict.text };
    if (verdict.text.includes("call review"))
      await review(workspaceId, sessionId).catch(() => {});
    return { wait: verdict.text };
  };
}

// The land's gate and merge: an approval the gate claims is given back if
// that merge is then refused.
export function landDeps(workspaceId: string) {
  const claimed = new Map<string, number>();
  return {
    beforeMerge: landGate(workspaceId, claimed),
    signOff: async (id: string, head?: string) => {
      const approval = claimed.get(id);
      claimed.delete(id);
      await refundIfRefused(id, approval, () =>
        LAND_DEFAULTS.signOff(id, head)
      );
    },
  };
}

// Lands a stack when every open item passes now; each merge is judged again
// at its head right before it happens.
export async function land(workspaceId: string, ref: string): Promise<string> {
  const stack = getStack(workspaceStack(workspaceId, ref).id);
  const open = stack.items.filter((i) => i.status === "pr" && i.taskId);
  const refusals: string[] = [];
  for (const item of open) {
    const task = workspaceTask(workspaceId, item.taskId!);
    const verdict = await judge(workspaceId, task, true);
    if (!verdict.ok) refusals.push(verdict.text);
  }
  if (refusals.length)
    throw new Error(`Not landing "${stack.name}":\n${refusals.join("\n")}`);
  const view = landInBackground(stack.id, landDeps(workspaceId));
  addNote(
    workspaceId,
    `Landing stack "${view.name}": ${open.length} PRs, each through the gates at its own head.`
  );
  return `Landing "${view.name}" bottom-up in the background; stack_status shows progress.`;
}
