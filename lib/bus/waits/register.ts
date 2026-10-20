// Registering a wait: `aos send --await` (in sendMessage) and `aos wait`.

import { statusDetector } from "../../status-detector";
import { statusOf } from "../../orchestrator/facts";
import { duration } from "../../schedules/when";
import { sessionById, tryResolveTarget } from "../targets";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  cantWaitOn,
  openWait,
  type WaitKind,
} from "./store";

// "30m", "2h", "1h30m"; empty is the default.
export function parseTimeout(text: string | null | undefined): number {
  const t = String(text ?? "").trim();
  if (!t) return DEFAULT_TIMEOUT_MS;
  const ms = duration(t.toLowerCase().replace(/([a-z])(?=\d)/g, "$1 "));
  if (ms === null)
    throw new Error(`Can't read the timeout "${t}": try 30m, 2h or 1h30m`);
  if (ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS)
    throw new Error("The timeout is between 1m and 24h");
  return ms;
}

export const UNTILS = ["idle", "merged", "reply"] as const;
export type Until = (typeof UNTILS)[number];

export async function registerWait(opts: {
  fromId: string;
  to: string;
  until: string;
  timeout?: string | null;
}): Promise<{
  id?: number;
  deadline?: number;
  already?: string;
  target: string;
}> {
  if (!(UNTILS as readonly string[]).includes(opts.until))
    throw new Error("--until is idle, merged or reply");
  const kind: WaitKind = opts.until as Until;
  const timeoutMs = parseTimeout(opts.timeout);
  const from = sessionById(opts.fromId);
  if (!from) throw new Error("Unknown sender session");
  const found = tryResolveTarget(opts.to, opts.fromId);
  if (!found.ok) throw new Error(found.error);
  const target = found.session;
  if (target.id === from.id) throw new Error("A session can't wait on itself");
  const why = cantWaitOn(target);
  if (why) throw new Error(`Can't wait on ${target.name}: ${why}`);

  if (kind === "merged") {
    if (target.pr_status === "merged" || target.task_status === "merged")
      return {
        already: `${target.name}'s PR is already merged`,
        target: target.name,
      };
    if (target.pr_status === "closed")
      throw new Error(`${target.name}'s PR was closed without merging`);
    if (!target.task_status && !target.pr_number && !target.branch_name)
      throw new Error(
        `${target.name} isn't a task and has no PR, so there is nothing to merge`
      );
  }
  if (kind === "idle") {
    await statusDetector.refreshCache();
    if ((await statusOf(target)).status === "idle")
      return { already: `${target.name} is idle now`, target: target.name };
  }
  const now = Date.now();
  const deadline = now + timeoutMs;
  const id = openWait({
    waiterId: from.id,
    targetId: target.id,
    kind,
    deadline,
    now,
  });
  return { id, deadline, target: target.name };
}
