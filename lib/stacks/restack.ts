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
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";
import { getProject } from "../projects";
import { itemName } from "./guard";
import { restackBranch, type Runner } from "./git";

export interface RestackDeps {
  runner: Runner;
  notify: (sessionId: string, body: string) => Promise<void>;
  defaultBranch: (repo: string) => Promise<string>;
}

const defaults: RestackDeps = {
  runner: (cmd, args, cwd) => run(cmd, args, cwd, 120000),
  notify: async (to, body) => {
    await sendMessage({ fromId: null, to, body }).catch(() => {});
  },
  defaultBranch: getDefaultBranch,
};

const sessionOf = (id: string | null) =>
  id
    ? ((db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
        | Session
        | undefined) ?? null)
    : null;

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
        (i.status === "running" || i.status === "pr")
    );
    out.push(...next);
    level = next.map((i) => i.id);
  }
  return out;
}

// Returns stuck = a direct child could not be moved, so the merged branch
// must stay on origin (its PR still targets it).
export async function restackAfterMerge(
  sessionId: string,
  deps: RestackDeps = defaults
): Promise<{ stuck: boolean; messages: string[] }> {
  const merged = q.itemForSession(db, sessionId);
  if (!merged) return { stuck: false, messages: [] };
  q.updateItem(db, merged.id, { status: "merged", error: null });
  return restackDescendants(merged, deps);
}

export function restackDescendants(
  root: StackItemRow,
  deps: RestackDeps = defaults
) {
  return restackItems(
    root,
    descendantsInOrder(q.items(db, root.stack_id), root.id),
    deps
  );
}

// Retry one item that needs attention (e.g. after a conflict was resolved
// by hand), and everything stacked on it.
export async function restackItem(
  itemId: string,
  deps: RestackDeps = defaults
) {
  const item = q.item(db, itemId);
  if (!item?.parent_item_id) throw new Error("Not a stacked item");
  const parent = q.item(db, item.parent_item_id)!;
  const order = [
    item,
    ...descendantsInOrder(q.items(db, item.stack_id), item.id),
  ];
  const result = await restackItems(parent, order, deps);
  if (result.failed) throw new Error(result.messages.join("\n"));
  return result;
}

// Moves each item in `order` (parents first). An item whose parent has
// merged moves onto the default branch and has its PR retargeted; any other
// moves onto its parent's (rewritten) branch.
async function restackItems(
  root: StackItemRow,
  order: StackItemRow[],
  deps: RestackDeps
): Promise<{ stuck: boolean; failed: boolean; messages: string[] }> {
  const items = q.items(db, root.stack_id);
  const rootSession = sessionOf(root.session_id);
  const project = rootSession?.project_id
    ? getProject(rootSession.project_id)
    : null;
  const messages: string[] = [];
  if (!order.length || !project)
    return { stuck: false, failed: false, messages };
  const repo = expandHome(project.working_directory);
  await deps.runner("git", ["fetch", "origin"], repo).catch(() => "");
  const main = await deps.defaultBranch(repo);

  const failed = new Set<string>();
  let stuck = false;
  const fail = (item: StackItemRow, direct: boolean, error: string) => {
    q.updateItem(db, item.id, { error });
    failed.add(item.id);
    stuck ||= direct;
    messages.push(error);
  };
  for (const item of order) {
    const parent = items.find((i) => i.id === item.parent_item_id)!;
    const direct = parent.status === "merged";
    const session = sessionOf(item.session_id);
    const onto = direct ? main : sessionOf(parent.session_id)?.branch_name;
    if (failed.has(parent.id)) {
      fail(
        item,
        direct,
        `Waits for ${itemName(parent)} to be restacked first.`
      );
      continue;
    }
    if (!session?.branch_name || !item.base_tip || !onto) {
      fail(
        item,
        direct,
        `${itemName(item)} has no branch or base commit to restack.`
      );
      continue;
    }
    const result = await restackBranch(
      {
        name: itemName(item),
        repo,
        worktree: session.worktree_path,
        branch: session.branch_name,
        oldTip: item.base_tip,
        onto,
        retargetPr: direct ? item.pr_number : null,
      },
      deps.runner
    );
    if (!result.ok) {
      fail(item, direct, result.error);
      continue;
    }
    q.updateItem(db, item.id, {
      base_branch: onto,
      base_tip: result.newTip,
      error: null,
    });
    db.prepare(`UPDATE sessions SET base_branch = ? WHERE id = ?`).run(
      onto,
      session.id
    );
    messages.push(result.message);
    await deps.notify(
      session.id,
      `AgentOS restacked ${session.branch_name} onto ${onto}` +
        (direct
          ? ` because ${itemName(parent)} merged, and retargeted your PR to ${onto}`
          : "") +
        ". The worktree is rebased in place; re-run your checks before you report."
    );
  }
  return { stuck, failed: failed.size > 0, messages };
}
