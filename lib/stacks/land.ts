/**
 * Land a stack: merge every PR bottom-up, ported from dispatch's `land`.
 * A preflight checks EVERY PR before anything merges. Each sign-off restacks
 * what sits on it, so a restacked PR's checks are waited out again (its green
 * was against the parent's branch). It stops at the first failure and says
 * what landed.
 */

import { db, stackQueries as q, type Session, type StackItemRow } from "../db";
import { signOffTask, taskPR, canSignOff, type TaskPR } from "../tasks";
import { itemName } from "./guard";
import { refreshItems } from "./tick";
import { outputOf } from "./git";

export interface LandDeps {
  signOff: (sessionId: string) => Promise<void>;
  prOf: (session: Session) => Promise<TaskPR | null>;
  sleep: (ms: number) => Promise<void>;
  refresh: (stackId: string) => Promise<void>;
  waitMs: number;
  everyMs: number;
}

const defaults: LandDeps = {
  // Waits for the restack, so its children are checked after they moved.
  signOff: (id) => signOffTask(id, { wait: true }),
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

export async function landStack(
  stackId: string,
  deps: LandDeps = defaults
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
      if (!verdict.ok) missing.push(`${itemName(item)}: ${verdict.reason}`);
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
      progress(`Merging ${name} (${n + 1}/${items.length})`);
      await deps.signOff(item.session_id!).catch((e: unknown) => {
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
