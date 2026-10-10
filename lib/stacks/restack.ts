/**
 * After a stacked parent squash-merges: move EVERY descendant, in order.
 * Direct children have their PR retargeted to the default branch and are
 * rebased `--onto origin/<default> <old parent tip>`, so the squashed
 * parent's commits drop out of their diff. Grandchildren are then rebased
 * onto their parent's rewritten branch the same way, and keep targeting it.
 */

import { db, stackQueries as q, type Session, type StackItemRow } from "../db";
import { getDefaultBranch } from "../git";
import { sendMessage } from "../bus";
import { findPRStrict, run } from "../tasks/gh";
import type { TaskPR } from "../tasks/state";
import { expandHome } from "../tasks/session";
import { getProject } from "../projects";
import { itemName } from "./guard";
import { outputOf, restackBranch, type Runner } from "./git";

// What a restack moved, for the code-review gate: a task's review of the
// head it pushed still covers the head AgentOS rebased it to. Not when the
// worktree had commits the task never pushed (the restack pushes them, so
// no review covers them). Restacked again without the task pushing, it
// keeps pointing at the task's own head.
function restackedHeads(
  item: StackItemRow,
  move: { from: string; to: string; unpushed: boolean }
): Pick<StackItemRow, "restacked_from" | "restacked_to"> {
  // A retry pushing the commit an interrupted restack already recorded.
  if (item.restacked_to === move.to && item.restacked_from)
    return { restacked_from: item.restacked_from, restacked_to: move.to };
  if (move.unpushed) return { restacked_from: null, restacked_to: null };
  const ours = item.restacked_to === move.from;
  return {
    restacked_from: ours ? item.restacked_from : move.from,
    restacked_to: move.to,
  };
}

export interface RestackDeps {
  runner: Runner;
  notify: (sessionId: string, body: string) => Promise<void>;
  // Stop the agent before its worktree is rewritten under it.
  interrupt: (session: Session) => Promise<void>;
  defaultBranch: (repo: string) => Promise<string>;
  // The branch's PR right now; throws when GitHub can't say.
  prOf: (repo: string, branch: string) => Promise<TaskPR | null>;
}

const defaults: RestackDeps = {
  runner: (cmd, args, cwd) => run(cmd, args, cwd, 120000),
  notify: async (to, body) => {
    await sendMessage({
      fromId: null,
      to,
      body,
      origin: { kind: "system", label: "AgentOS stacks", body },
    }).catch(() => {});
  },
  interrupt: async (session) => {
    const sent = await run(
      "tmux",
      ["send-keys", "-t", `=${session.tmux_name}:`, "Escape"],
      "/"
    ).then(
      () => true,
      () => false
    );
    if (sent) await new Promise((r) => setTimeout(r, 1500));
  },
  defaultBranch: getDefaultBranch,
  prOf: findPRStrict,
};

const sessionOf = (id: string | null) =>
  id
    ? ((db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
        | Session
        | undefined) ?? null)
    : null;

const LIVE = new Set(["running", "pr"]);

// Descendants of `rootId` that are still open, parents before children.
export function descendantsInOrder(
  items: StackItemRow[],
  rootId: string
): StackItemRow[] {
  const out: StackItemRow[] = [];
  let level = [rootId];
  while (level.length) {
    const next = items.filter(
      (i) =>
        i.parent_item_id &&
        level.includes(i.parent_item_id) &&
        LIVE.has(i.status)
    );
    out.push(...next);
    level = next.map((i) => i.id);
  }
  return out;
}

// One restack at a time per stack: a sign-off and the watcher's
// reconciliation can both ask for the same move.
const queues = new Map<string, Promise<unknown>>();

function serially<T>(stackId: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(stackId) ?? Promise.resolve()).then(job, job);
  const tail = next.catch(() => {});
  queues.set(stackId, tail);
  void tail.then(() => {
    if (queues.get(stackId) === tail) queues.delete(stackId);
  });
  return next;
}

export type RestackOutcome = {
  stuck: boolean;
  failed: boolean;
  messages: string[];
};

// Returns stuck = a direct child could not be moved (or its PR state is
// unknown), so the merged branch must stay on origin: its PR may target it.
export async function restackAfterMerge(
  sessionId: string,
  deps: RestackDeps = defaults
): Promise<RestackOutcome> {
  const merged = q.itemForSession(db, sessionId);
  if (!merged) return { stuck: false, failed: false, messages: [] };
  q.updateItem(db, merged.id, { status: "merged", error: null });
  return restackDescendants(merged, deps);
}

export function restackDescendants(
  root: StackItemRow,
  deps: RestackDeps = defaults
): Promise<RestackOutcome> {
  return serially(root.stack_id, () =>
    restackItems(
      root.id,
      descendantsInOrder(q.items(db, root.stack_id), root.id).map((i) => i.id),
      deps
    )
  );
}

// Retry one item (e.g. after a conflict was resolved by hand), and
// everything stacked on it.
export async function restackItem(
  itemId: string,
  deps: RestackDeps = defaults
): Promise<RestackOutcome> {
  const item = q.item(db, itemId);
  if (!item?.parent_item_id) throw new Error("Not a stacked item");
  const result = await serially(item.stack_id, () =>
    restackItems(
      item.parent_item_id!,
      [
        item.id,
        ...descendantsInOrder(q.items(db, item.stack_id), item.id).map(
          (i) => i.id
        ),
      ],
      deps,
      true
    )
  );
  if (result.failed) throw new Error(result.messages.join("\n"));
  return result;
}

// Moves each item in `order` (parents first), re-read inside the queue. An
// item whose parent has merged moves onto the default branch and has its PR
// retargeted; any other moves onto its parent's (rewritten) branch.
async function restackItems(
  rootId: string,
  order: string[],
  deps: RestackDeps,
  retry = false
): Promise<RestackOutcome> {
  const root = q.item(db, rootId);
  const rootSession = sessionOf(root?.session_id ?? null);
  const project = rootSession?.project_id
    ? getProject(rootSession.project_id)
    : null;
  const messages: string[] = [];
  const failed = new Set<string>();
  let stuck = false;
  if (!root || !project || !order.length) {
    return { stuck, failed: false, messages };
  }
  const items = new Map(q.items(db, root.stack_id).map((i) => [i.id, i]));
  const fail = (item: StackItemRow, direct: boolean, error: string) => {
    q.updateItem(db, item.id, { error, note: null });
    failed.add(item.id);
    stuck ||= direct;
    messages.push(error);
  };
  const repo = expandHome(project.working_directory);
  const fetched = await deps.runner("git", ["fetch", "origin"], repo).then(
    () => null,
    (error: unknown) => outputOf(error).slice(0, 200)
  );
  const main = await deps.defaultBranch(repo);

  for (const id of order) {
    const item = items.get(id);
    const parent = item?.parent_item_id ? items.get(item.parent_item_id) : null;
    if (!item || !parent || !LIVE.has(item.status)) continue;
    const direct = parent.status === "merged";
    // Already moved by an earlier run (a sign-off and the watcher overlap).
    if (direct && item.base_branch === main && !retry) continue;
    if (fetched !== null) {
      fail(
        item,
        direct,
        `Could not fetch origin, so ${itemName(item)} was not restacked: ${fetched}. Restack again once it works.`
      );
      continue;
    }
    if (failed.has(parent.id)) {
      fail(
        item,
        direct,
        `Waits for ${itemName(parent)} to be restacked first.`
      );
      continue;
    }
    const session = sessionOf(item.session_id);
    const onto = direct ? main : sessionOf(parent.session_id)?.branch_name;
    if (!session?.branch_name || !item.base_tip || !onto) {
      fail(
        item,
        direct,
        `${itemName(item)} has no branch or base commit to restack.`
      );
      continue;
    }
    let prNumber = item.pr_number;
    if (direct) {
      // The watcher fills pr_number once a minute; a PR opened since would
      // be closed by GitHub when the parent's branch goes.
      try {
        const pr = await deps.prOf(repo, session.branch_name);
        prNumber = pr?.state === "OPEN" ? pr.number : null;
        if (prNumber)
          q.updateItem(db, item.id, { pr_number: prNumber, status: "pr" });
      } catch (error) {
        fail(
          item,
          true,
          `Couldn't read ${itemName(item)}'s PR from GitHub, so ${itemName(parent)}'s branch stays on origin: ${outputOf(error).slice(0, 200)}. Restack again once it works.`
        );
        continue;
      }
    }

    if (!direct) {
      // Its parent's branch didn't move: nothing to do, and no reason to
      // interrupt its agent.
      const tip = await deps
        .runner(
          "git",
          ["rev-parse", "--verify", "--quiet", `origin/${onto}`],
          repo
        )
        .then(
          (out) => out.trim(),
          () => null
        );
      if (tip === item.base_tip) continue;
    }
    q.updateItem(db, item.id, { note: `Restacking onto ${onto}` });
    await deps.interrupt(session);
    const result = await restackBranch(
      {
        name: itemName(item),
        repo,
        worktree: session.worktree_path,
        branch: session.branch_name,
        oldTip: item.base_tip,
        onto,
        retargetPr: direct ? prNumber : null,
        beforePush: (move) =>
          q.updateItem(db, item.id, restackedHeads(item, move)),
      },
      deps.runner
    );
    if (!result.ok) {
      fail(item, direct, result.error);
      await deps.notify(
        session.id,
        `AgentOS paused you to restack ${session.branch_name} onto ${onto}, but it could not: ${result.error} Carry on with your work; a human will sort the restack out.`
      );
      continue;
    }
    q.updateItem(db, item.id, {
      base_branch: onto,
      base_tip: result.newTip,
      error: null,
      note: null,
    });
    items.set(item.id, { ...item, base_branch: onto, base_tip: result.newTip });
    db.prepare(`UPDATE sessions SET base_branch = ? WHERE id = ?`).run(
      onto,
      session.id
    );
    messages.push(result.message);
    const pr = !direct
      ? ""
      : prNumber
        ? ` because ${itemName(parent)} merged, and retargeted your PR to ${onto}`
        : ` because ${itemName(parent)} merged. Open your PR against ${onto}, not ${parent.base_branch ?? "the old branch"}`;
    await deps.notify(
      session.id,
      `AgentOS paused you and restacked ${session.branch_name} onto ${onto}${pr}. The worktree is rebased in place: re-run your checks, then carry on where you were.`
    );
  }
  return { stuck, failed: failed.size > 0, messages };
}
