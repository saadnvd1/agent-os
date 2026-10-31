// When an automatic update starts, as one pure decision so it can be tested
// as a table. lib/updates/run.ts gathers the input and acts on the answer.
//
//   1. Switched off, pinned off, deployed by autodeploy, or refused (local
//      changes, diverged, dev server, no restart command...) → skip, say why.
//   2. The target is the newest commit on the remote's first-parent line
//      that has been there `soakMs`, so a bad push can be reverted before an
//      install takes it, and a busy day of merges can't hold it off. A
//      commit that was rolled back, or failed to build recently, is passed
//      over for an older one still newer than what's installed.
//   3. Nothing a restart would interrupt is in flight (agents working, chat
//      turns, reviews, task setups, simulator starts, merges, stack
//      landings, an update or deploy), and has not been for `idleMs`.
//   4. Once a release has waited `deadlineMs` past its soak, a lull of
//      `lullMs` is enough. It never interrupts work; it keeps waiting.

import type { UpdateAttempt } from "./banner";
import { blockFor } from "./history";

export interface Candidate {
  sha: string;
  /** Commit time, ms. */
  at: number;
}

export interface AutoInput {
  enabled: boolean;
  locked: boolean;
  managed: boolean;
  refusal: string | null;
  /** First-parent commits newer than the installed one, newest first. */
  candidates: Candidate[];
  attempts: UpdateAttempt[];
  /** What is working now; empty when nothing is. */
  busy: string[];
  /** Since when nothing has been working, as far as anyone watched. */
  quietSince: number | null;
  now: number;
  soakMs: number;
  idleMs: number;
  deadlineMs: number;
  lullMs?: number;
}

export type AutoDecision =
  | { action: "start"; to: string }
  | { action: "wait"; code: AutoWait; text: string; to?: string }
  | { action: "skip"; code: AutoSkip; text: string };

export type AutoSkip = "off" | "locked" | "managed" | "refused" | "up_to_date";
export type AutoWait = "soaking" | "blocked" | "busy" | "quiet";

export const LULL_MS = 2 * 60_000;

const short = (sha: string) => sha.slice(0, 7);
const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The commit to update to, or why there's none yet. */
export function pickTarget(
  input: Pick<AutoInput, "candidates" | "attempts" | "now" | "soakMs">
):
  | { to: string; eligibleSince: number }
  | {
      to?: undefined;
      code: "soaking" | "blocked";
      text: string;
      until?: number;
    } {
  const { candidates, attempts, now, soakMs } = input;
  const soaked = candidates.filter((c) => c.at + soakMs <= now);
  if (!soaked.length) {
    const next = Math.min(...candidates.map((c) => c.at + soakMs));
    return {
      code: "soaking",
      text: `A new version came out recently; it updates once it has been out ${plural(mins(soakMs), "minute")}.`,
      until: next,
    };
  }
  let first: string | null = null;
  for (const c of soaked) {
    const block = blockFor(c.sha, attempts, now);
    if (!block)
      return {
        to: c.sha,
        // The oldest waiting release says how long updates have been put off.
        eligibleSince: soaked[soaked.length - 1].at + soakMs,
      };
    first ??= `${short(c.sha)}: ${block.reason}`;
  }
  return {
    code: "blocked",
    text: `Not updating to ${first}. Waiting for a newer version.`,
  };
}

export function decideAutoUpdate(input: AutoInput): AutoDecision {
  if (input.locked)
    return {
      action: "skip",
      code: "locked",
      text: "Automatic updates are turned off by AGENTOS_AUTO_UPDATE.",
    };
  if (!input.enabled)
    return { action: "skip", code: "off", text: "Automatic updates are off." };
  if (input.managed)
    return {
      action: "skip",
      code: "managed",
      text: "Updates on this machine are deployed by autodeploy.",
    };
  if (input.refusal)
    return {
      action: "skip",
      code: "refused",
      text: `Automatic updates are paused. ${input.refusal}`,
    };
  if (!input.candidates.length)
    return {
      action: "skip",
      code: "up_to_date",
      text: "AgentOS is up to date.",
    };

  const target = pickTarget(input);
  if (!("eligibleSince" in target))
    return { action: "wait", code: target.code, text: target.text };

  if (input.busy.length)
    return {
      action: "wait",
      code: "busy",
      to: target.to,
      text: `Updates when nothing is working (now: ${input.busy.join(", ")}).`,
    };
  const late = input.now - target.eligibleSince >= input.deadlineMs;
  const need = late ? (input.lullMs ?? LULL_MS) : input.idleMs;
  const quietFor = input.quietSince === null ? 0 : input.now - input.quietSince;
  if (quietFor < need)
    return {
      action: "wait",
      code: "quiet",
      to: target.to,
      text: late
        ? "Has waited a long time for a quiet moment; updates at the next short lull."
        : `Updates after everything has been idle for ${plural(mins(input.idleMs), "minute")} (${plural(mins(need - quietFor), "minute")} to go).`,
    };
  return { action: "start", to: target.to };
}
