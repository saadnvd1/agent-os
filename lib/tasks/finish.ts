import { db, type Session } from "../db";
import { endPauseOnFinish } from "./pause-hold";
import { dropThere, mergeThere } from "./contract/actions";
import { isMirror } from "./contract/start";
import { deleteWorktree } from "../worktrees";
import { settleWorktree, type MergedAs } from "../done/worktree";
import {
  syncTaskCardInBackground,
  inBackground,
} from "../lumifyhub/task-cards";
import { republishAfterMerge } from "../lumifyhub/publish";
import { restackAfterMerge } from "../stacks/restack";
import { itemName, liveChildren, signOffRefusal } from "../stacks/guard";
import { holderRefusal } from "./held";
import { resolveMergedTaskAsks } from "../orchestrator/ask-settle";
import { endSessionAgent } from "../sessions/end";
import { run } from "./gh";
import { pushMerged } from "../notify/push/events";
import { gitFetch } from "../git-exec";
import { deleteTaskBranch } from "./remote-branch";
import {
  mergePolicy,
  type MergeMethod,
  type MergePolicy,
} from "./merge-policy";
import { mergePR } from "./merge-pr";
import { getProject } from "../projects";
import { canSignOff } from "./state";
import {
  forgetPR,
  expandHome,
  getTaskSession,
  isAllowedBase,
  prFor,
  projectPathFor,
} from "./session";
import { releaseSessionLeftovers } from "../sessions/leftovers";
import { captureMergedTask } from "../session-logs";
import { taskEnded } from "../reports/end-hook";
import { sessionEnded } from "../experiments/hooks";
import { snapshotWorktree } from "../resurrect/snapshot";
import { keepSessionFiles } from "../session-artifacts/collect";
import { setPr, setTask } from "../db/session-parts";
import { isFast } from "../project-tier/getProjectTier";

export const sessionMergePolicy = (session: Session): MergePolicy =>
  mergePolicy(session.project_id ? getProject(session.project_id) : null);

// After a merge (`merged`), the worktree goes only if nothing in it would
// be lost and the merge settings delete worktrees; a drop removes it
// whatever it holds.
async function cleanup(
  session: Session,
  repo: string,
  opts: {
    keepRemoteBranch?: boolean;
    merged?: MergedAs;
    // The head the PR merged or closed at.
    prHead?: string | null;
    // A drop of a task that never had a PR.
    noPr?: boolean;
  } = {}
): Promise<void> {
  const keepRemoteBranch = opts.keepRemoteBranch ?? false;
  await endSessionAgent(session);
  // Never waited on: the row is read now, and Postgres can't hold this up.
  void releaseSessionLeftovers(session);
  if (session.worktree_path && opts.merged) {
    const fate = await settleWorktree(session, opts.merged).catch(() => null);
    if (fate?.action === "kept")
      console.log(`[tasks] kept ${fate.path} after merge: ${fate.why}`);
  } else if (session.worktree_path) {
    await keepSessionFiles(session.id);
    await deleteWorktree(session.worktree_path, repo, true).catch(() => {});
  }
  // A stacked child's PR targets this branch: deleting it on origin would
  // make GitHub close that PR, and a closed PR can't be retargeted.
  if (session.branch_name && !keepRemoteBranch) {
    await deleteTaskBranch({
      repo,
      branch: session.branch_name,
      prHead: opts.prHead,
      noPr: opts.noPr,
      keep: [session.base_branch],
    });
  }
  await gitFetch(repo, ["--prune", "--quiet"]).catch(() => {});
  forgetPR(session.id);
}

// Sign-offs between `gh pr merge` and the database knowing it, so the
// watcher doesn't read our own merge as one done on GitHub.
export const signingOff = new Set<string>();

// What happens after a merge: restack anything stacked on it, then remove the
// session, worktree and branch. Kept per task so Land and done can wait for
// it; on globalThis because the watcher's merges run in server.ts and done in
// a route bundle, which load this module separately.
const g = globalThis as unknown as {
  __agentosAfterMerge?: Map<string, Promise<void>>;
};
const afterMerge: Map<string, Promise<void>> = (g.__agentosAfterMerge ??=
  new Map());

async function finishMerge(
  session: Session,
  repo: string,
  prHead: string | null,
  policy: MergePolicy
): Promise<void> {
  // Before cleanup deletes this branch on origin: children are retargeted
  // first. One that could not be moved keeps the branch alive.
  const { stuck } = await restackAfterMerge(session.id).catch(
    (error: unknown) => {
      console.error(`[stacks] restack after ${session.id}:`, error);
      return { stuck: true };
    }
  );
  await cleanup(session, repo, {
    keepRemoteBranch: stuck || !policy.delete_remote_branch,
    merged: { prHead },
    prHead,
  });
  // After cleanup's fetch, so the base branch holds the merged files.
  inBackground(`re-publish docs after task ${session.id}`, () =>
    republishAfterMerge(session)
  );
}

// Merge the PR with the project's merge method; the restack and cleanup
// run after it in the background (`wait` to wait for them). The checks are
// re-read here: the button is not the guard. With `head`, GitHub merges
// only that commit. Returns the method it merged with (null when a linked
// machine merged it and didn't say).
export async function signOffTask(
  id: string,
  opts: {
    wait?: boolean;
    head?: string;
    device?: string | null;
    // The base another machine judged the gates against (a forwarded merge).
    base?: string;
  } = {}
): Promise<MergeMethod | null> {
  const session = getTaskSession(id);
  if (session.task_status !== "running")
    throw new Error(`Task is already ${session.task_status}`);
  // A task another machine's orchestrator moved here merges only from there.
  const held = holderRefusal(session, opts.device);
  if (held) throw new Error(held);
  // Its own machine checks the gates and merges.
  // That machine's settings chose the method; null if it didn't say.
  if (isMirror(session))
    return mergeThere(session, opts.head, session.base_branch);
  const repo = projectPathFor(session);
  if (!repo) throw new Error("Task has no project");
  const refusal = signOffRefusal(id);
  if (refusal) throw new Error(refusal);
  // prFor follows a retarget onto the record, so compare with what the
  // checks above were judged against.
  // A forwarded merge was judged on the other machine against the base it
  // recorded, which may be newer than this machine's row; only a base this
  // task may have is taken.
  if (
    opts.base &&
    opts.base !== session.base_branch &&
    !(await isAllowedBase(session, repo, opts.base))
  )
    throw new Error(`${opts.base} isn't a base ${session.name} may merge into`);
  const judgedBase = opts.base ?? session.base_branch;
  const pr = await prFor(session, true);
  const verdict = canSignOff(pr, { ci: !isFast(session) });
  if (!verdict.ok) throw new Error(verdict.reason);
  if (pr!.base && pr!.base !== judgedBase)
    throw new Error(
      `PR #${pr!.number} targets ${pr!.base}, not its base ${judgedBase ?? "(none)"}: its review and checks were for the old base`
    );
  if (opts.head && pr!.head && pr!.head !== opts.head)
    throw new Error(
      `The PR moved to ${pr!.head.slice(0, 7)} after ${opts.head.slice(0, 7)} was checked`
    );
  const policy = sessionMergePolicy(session);
  signingOff.add(id);
  try {
    await mergePR({
      repo,
      number: pr!.number,
      method: policy.method,
      head: opts.head,
    });
    db.transaction(() => {
      setTask(db, id, { task_status: "merged" });
      setPr(db, id, { pr_status: "merged" });
    })();
    endPauseOnFinish(id);
    db.prepare(
      `UPDATE stack_items SET status = 'merged', error = NULL WHERE session_id = ?`
    ).run(id);
  } finally {
    signingOff.delete(id);
  }
  syncTaskCardInBackground(session, "merged", pr);
  pushMerged(id);
  // Reads the plan file now: cleanup below removes the worktree.
  void captureMergedTask(id, { head: opts.head ?? pr!.head ?? null });
  taskEnded(id);
  void sessionEnded(id, "merged");
  const head = opts.head ?? pr!.head;
  resolveMergedTaskAsks(
    id,
    pr!.url,
    `PR #${pr!.number} merged${head ? ` at ${head.slice(0, 7)}` : ""} by sign-off`
  );
  const done = finishMerge(
    session,
    repo,
    opts.head ?? pr!.head ?? null,
    policy
  ).finally(() => afterMerge.delete(id));
  afterMerge.set(id, done);
  if (opts.wait) await done;
  return policy.method;
}

// Between `gh pr merge` and the end of the tidying after it.
export const isMerging = (id: string): boolean =>
  signingOff.has(id) || afterMerge.has(id);

export function mergeSettled(id: string): Promise<void> {
  return afterMerge.get(id) ?? Promise.resolve();
}

// Reject the work: close the PR if there is one and remove everything.
// Refused while cards are stacked on it: their base is this branch.
export async function dropTask(id: string): Promise<void> {
  const session = getTaskSession(id);
  if (session.task_status !== "running")
    throw new Error(`Task is already ${session.task_status}`);
  if (isMirror(session)) {
    await dropThere(session);
    return;
  }
  const repo = projectPathFor(session);
  if (!repo) throw new Error("Task has no project");
  const children = liveChildren(id);
  if (children.length) {
    const names = children.map(itemName).join(", ");
    throw new Error(
      `${names} ${children.length === 1 ? "is" : "are"} stacked on this task and built on its branch. Drop ${children.length === 1 ? "it" : "them"} first, or sign this one off.`
    );
  }
  // Saved while the PR is closed below, and settled before the worktree goes:
  // a restore finds its uncommitted files and plan here. Never throws.
  const snapshot = snapshotWorktree(
    session.worktree_path && expandHome(session.worktree_path),
    id
  );
  const pr = await prFor(session, true);
  if (pr?.state === "OPEN") {
    await run("gh", ["pr", "close", String(pr.number)], repo).catch(() => {});
  }
  setTask(db, id, { task_status: "dropped" });
  endPauseOnFinish(id);
  db.prepare(
    `UPDATE stack_items SET status = 'dropped' WHERE session_id = ?`
  ).run(id);
  syncTaskCardInBackground(session, "dropped", pr);
  await snapshot;
  await cleanup(session, repo, { prHead: pr?.head, noPr: !pr });
}
