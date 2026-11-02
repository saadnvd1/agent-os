/**
 * How a child ends: it returns (`aos return`), its turn ends without one and
 * its last reply stands in after a grace, it is cancelled, or it can't be
 * run. A child settles once; the settle that changed the row does the rest.
 */

import fs from "fs";
import path from "path";
import { db, queries, type Session } from "../db";
import { git } from "../git-exec";
import { statusOf } from "../orchestrator/facts";
import { openWaits } from "../bus/waits/store";
import { lastItems } from "../chat/store";
import { stopChat } from "../chat/runner";
import type { UsageTotals } from "../chat/events";
import {
  getChild,
  markIdle,
  setState,
  settleChild,
  summaryOf,
  updateResult,
  childrenOf,
  findChild,
  markDeliveredIds,
} from "./ledger";
import { FORK_LIMITS } from "./options";
import { forksRoot, removeFork, worktreeOf } from "./scratch";
import type { ChildOutcome, ChildRow, ResultKind } from "./types";

const sessionOf = (id: string) =>
  queries.getSession(db).get(id) as Session | undefined;

function tokensOf(childId: string) {
  const raw = (
    db.prepare(`SELECT chat_usage FROM sessions WHERE id = ?`).get(childId) as
      { chat_usage: string | null } | undefined
  )?.chat_usage;
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as UsageTotals;
    return {
      in: u.inputTokens,
      out: u.outputTokens,
      cacheRead: u.cacheReadTokens,
    };
  } catch {
    return null;
  }
}

export const patchPath = (childId: string) =>
  path.join(forksRoot(), `${childId}.patch`);

// What a child changed in its own checkout, kept as a patch the parent can
// apply: its checkout goes with it.
async function keepPatch(childId: string): Promise<string | null> {
  const wt = worktreeOf(childId);
  if (!fs.existsSync(wt)) return null;
  try {
    await git(wt, ["add", "-A"]);
    const diff = await git(wt, ["diff", "--cached", "HEAD", "--binary"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!diff.trim()) return null;
    const file = patchPath(childId);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, diff);
    return file;
  } catch {
    return null;
  }
}

export interface Settlement {
  outcome: ChildOutcome;
  summary: string;
  result?: string | null;
  kind: ResultKind;
}

// Settles, tidies up and starts what was waiting for the room. True when
// this call was the one that settled it.
export async function settleAndDeliver(
  childId: string,
  s: Settlement
): Promise<boolean> {
  const row = getChild(childId);
  if (!row || row.state === "settled") return false;
  let result = s.result ?? null;
  if (row.worktree && s.outcome !== "cancelled") {
    const patch = await keepPatch(childId);
    if (patch)
      result =
        `${result ?? ""}\n\nIts changes are in ${patch} (apply with \`git apply ${patch}\`).`.trim();
  }
  const changed = settleChild(childId, {
    ...s,
    result,
    tokens: tokensOf(childId),
  });
  if (!changed) return false;
  // Cancelled by its parent or the user: they know, so nothing is sent.
  if (s.outcome === "cancelled") markDeliveredIds([childId]);
  await removeFork(childId).catch(() => undefined);
  const { admitQueued } = await import("./start");
  await admitQueued(row.parent_session_id).catch(() => undefined);
  const { kickForks } = await import("./tick");
  kickForks();
  return true;
}

// `aos return`. After settling it replaces the result, shown as updated.
export async function returnChild(
  childId: string,
  text: string,
  failed: boolean
): Promise<"settled" | "updated"> {
  const row = getChild(childId);
  if (!row) throw new Error("Only a fork child can return a result");
  const body = text.trim();
  if (!body) throw new Error('Give the result: aos return "<result>"');
  const outcome: ChildOutcome = failed ? "failed" : "ok";
  if (
    await settleAndDeliver(childId, {
      outcome,
      summary: summaryOf(body),
      result: body,
      kind: "explicit",
    })
  )
    return "settled";
  updateResult(childId, summaryOf(body), body, outcome);
  return "updated";
}

export async function cancelChild(childId: string): Promise<boolean> {
  const row = getChild(childId);
  if (!row || row.state === "settled") return false;
  if (row.state !== "queued") stopChat(childId);
  return settleAndDeliver(childId, {
    outcome: "cancelled",
    summary: "cancelled",
    kind: "implicit",
  });
}

export async function cancelChildren(
  parentId: string,
  ref?: string
): Promise<ChildRow[]> {
  const targets = ref
    ? [findChild(parentId, ref)]
    : childrenOf(parentId).filter((c) => c.state !== "settled");
  const done: ChildRow[] = [];
  for (const c of targets)
    if (await cancelChild(c.child_session_id)) done.push(c);
  return done;
}

const lastReply = (childId: string): string => {
  const said = lastItems(childId, 40)
    .reverse()
    .find((i) => i.kind === "assistant" && i.text.trim());
  return said?.kind === "assistant" ? said.text.trim() : "";
};

// One look at a child that hasn't settled: needing an answer, still working,
// gone, or idle long enough that its last reply is its result.
export async function lookAtChild(row: ChildRow, now: number): Promise<void> {
  if (row.state === "queued" || row.state === "settled") return;
  const session = sessionOf(row.child_session_id);
  if (!session || session.archived_at) {
    await settleAndDeliver(row.child_session_id, {
      outcome: "failed",
      summary: "its session was closed before it returned",
      kind: "implicit",
    });
    return;
  }
  const { status, activity } = await statusOf(session);
  if (status === "waiting") {
    setState(
      row.child_session_id,
      "needs_input",
      activity ?? "waiting for an answer"
    );
    markIdle(row.child_session_id, null);
    return;
  }
  if (status === "running" || status === "dead") {
    if (row.state !== "running" || row.hold)
      setState(row.child_session_id, "running");
    markIdle(row.child_session_id, null);
    return;
  }
  if (row.state === "starting") return;
  if (row.state !== "running" || row.hold)
    setState(row.child_session_id, "running");
  if (row.idle_since == null) {
    markIdle(row.child_session_id, now);
    return;
  }
  if (now - row.idle_since < FORK_LIMITS.implicitGraceMs) return;
  // It asked its parent something and is waiting for the answer.
  if (openWaits().some((w) => w.waiter_id === row.child_session_id)) return;
  const reply = lastReply(row.child_session_id);
  if (!reply) return;
  await settleAndDeliver(row.child_session_id, {
    outcome: "ok",
    summary: summaryOf(reply),
    result: reply,
    kind: "implicit",
  });
}
