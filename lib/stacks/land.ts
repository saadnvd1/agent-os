/**
 * Land a stack: merge every PR bottom-up, ported from dispatch's `land`.
 * A preflight checks EVERY PR before anything merges: CI, and a Code review
 * section in its body for its head commit. Each sign-off restacks
 * what sits on it, so a restacked PR's checks are waited out again (its green
 * was against the parent's branch). It stops at the first failure and says
 * what landed.
 */

import { db, stackQueries as q, type Session, type StackItemRow } from "../db";
import {
  signOffTask,
  taskPR,
  canSignOff,
  codeReviewRefusal,
  type TaskPR,
} from "../tasks";
import { itemName } from "./guard";
import { refreshItems } from "./tick";
import { outputOf } from "./git";

// Asked right before each merge: the commit that may merge, a reason to
// wait (and ask again), or a reason to stop the land.
export type MergeGate = (
  sessionId: string
) => Promise<{ head: string } | { wait: string } | { stop: string }>;

export interface LandDeps {
  signOff: (sessionId: string, head?: string) => Promise<void>;
  beforeMerge?: MergeGate;
  prOf: (session: Session) => Promise<TaskPR | null>;
  sleep: (ms: number) => Promise<void>;
  refresh: (stackId: string) => Promise<void>;
  waitMs: number;
  everyMs: number;
}

export const LAND_DEFAULTS: LandDeps = {
  // Waits for the restack, so its children are checked after they moved.
  signOff: (id, head) => signOffTask(id, { wait: true, head }),
  prOf: (s) => taskPR(s, true),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  refresh: refreshItems,
  waitMs: 45 * 60_000,
  everyMs: 30_000,
};

const sessionOf = (id: string | null) =>
  (id
    ? db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
    : undefined) as Session | undefined;

class Stop extends Error {}

async function waitGreen(
  item: StackItemRow,
  hadChecks: boolean,
  deps: LandDeps
) {
  for (let waited = 0; ; waited += deps.everyMs) {
    // A fresh push has no checks for a moment; never read that as green.
    await deps.sleep(deps.everyMs);
    const session = sessionOf(item.session_id);
    const pr = session ? await deps.prOf(session) : null;
    const checks = pr?.checks;
    if (pr?.state !== "OPEN")
      throw new Stop(`its PR is ${pr?.state.toLowerCase() ?? "gone"}`);
    if (checks === "pass" || (checks === "none" && !hadChecks)) return;
    if (checks === "fail") throw new Stop("CI failed after the restack");
    if (waited + deps.everyMs >= deps.waitMs) {
      throw new Stop(
        `CI still ${checks} after ${Math.round(deps.waitMs / 60_000)} min`
      );
    }
  }
}

// Without the orchestrator's gate: the item's head right before merging,
// only if its Code review section covers that commit. A push since the
// preflight needs a new review; the merge is pinned to this head.
async function reviewedHead(
  item: StackItemRow,
  deps: LandDeps
): Promise<string> {
  const now = q.item(db, item.id) ?? item;
  const session = sessionOf(now.session_id);
  const pr = session ? await deps.prOf(session) : null;
  const refusal = pr
    ? codeReviewRefusal(pr.codeReview, pr.head, {
        from: now.restacked_from,
        to: now.restacked_to,
      })
    : "its PR is gone";
  if (refusal) throw new Stop(`stopped at ${itemName(now)}: ${refusal}`);
  return pr!.head!;
}

// The head an item may merge at, once its gate says so.
async function gated(
  item: StackItemRow,
  gate: MergeGate,
  deps: LandDeps,
  waiting: (why: string) => void
): Promise<string> {
  for (let waited = 0; ; waited += deps.everyMs) {
    const verdict = await gate(item.session_id!);
    if ("head" in verdict) return verdict.head;
    if ("stop" in verdict)
      throw new Stop(`stopped at ${itemName(item)}: ${verdict.stop}`);
    if (waited >= deps.waitMs)
      throw new Stop(
        `stopped at ${itemName(item)}, still waiting: ${verdict.wait}`
      );
    waiting(verdict.wait);
    await deps.sleep(deps.everyMs);
  }
}

export async function landStack(
  stackId: string,
  deps: LandDeps = LAND_DEFAULTS
): Promise<void> {
  const progress = (text: string) => q.update(db, stackId, { progress: text });
  q.update(db, stackId, {
    status: "landing",
    error: null,
    progress: "Checking every PR",
  });
  const landed: string[] = [];
  try {
    await deps.refresh(stackId);
    const items = q
      .items(db, stackId)
      .filter((i) => i.status === "pr" || i.status === "running");
    if (!items.length) throw new Stop("nothing to land: no item has a PR");

    const missing: string[] = [];
    const hadChecks = new Map<string, boolean>();
    for (const item of items) {
      const session = sessionOf(item.session_id);
      const pr =
        session && item.status === "pr" ? await deps.prOf(session) : null;
      const verdict = canSignOff(pr);
      const unreviewed =
        pr &&
        codeReviewRefusal(pr.codeReview, pr.head, {
          from: item.restacked_from,
          to: item.restacked_to,
        });
      if (!verdict.ok) missing.push(`${itemName(item)}: ${verdict.reason}`);
      else if (unreviewed) missing.push(`${itemName(item)}: ${unreviewed}`);
      else if (item.error) missing.push(`${itemName(item)}: ${item.error}`);
      hadChecks.set(item.id, pr?.checks !== "none");
    }
    if (missing.length) {
      throw new Stop(`not landing, fix these first:\n${missing.join("\n")}`);
    }

    const tips = new Map(items.map((i) => [i.id, i.base_tip]));
    for (const [n, before] of items.entries()) {
      const item = q.item(db, before.id)!;
      const name = itemName(item);
      if (item.base_tip !== tips.get(item.id)) {
        progress(
          `Waiting for ${name}'s checks after the restack (${n + 1}/${items.length})`
        );
        await waitGreen(item, hadChecks.get(item.id)!, deps).catch(
          (e: unknown) => {
            throw new Stop(
              `stopped at ${name}, before merging it: ${outputOf(e)}`
            );
          }
        );
      }
      const head = deps.beforeMerge
        ? await gated(item, deps.beforeMerge, deps, (why) =>
            progress(`Waiting on ${name}: ${why} (${n + 1}/${items.length})`)
          )
        : await reviewedHead(item, deps);
      progress(`Merging ${name} (${n + 1}/${items.length})`);
      await deps.signOff(item.session_id!, head).catch((e: unknown) => {
        throw new Stop(`stopped at ${name}: ${outputOf(e)}`);
      });
      landed.push(name);
      const stuck = q
        .items(db, stackId)
        .find(
          (c) =>
            c.parent_item_id === item.id &&
            c.error &&
            (c.status === "pr" || c.status === "running")
        );
      if (stuck) {
        throw new Stop(
          `stopped after ${name}: ${itemName(stuck)} could not be restacked. ${stuck.error}`
        );
      }
    }
    const left = q
      .items(db, stackId)
      .filter((i) => i.status === "planned" || i.status === "held").length;
    q.update(db, stackId, {
      status: left ? "running" : "landed",
      landed_at: left ? null : new Date().toISOString(),
      progress:
        `Landed ${landed.length}: ${landed.join(", ")}` +
        (left ? `. ${left} card${left === 1 ? "" : "s"} still to go` : ""),
    });
  } catch (error) {
    const so = landed.length ? landed.join(", ") : "nothing";
    q.update(db, stackId, {
      status: "failed",
      progress: null,
      error: `${error instanceof Stop ? error.message : outputOf(error)}\nLanded so far: ${so}`,
    });
  }
}
