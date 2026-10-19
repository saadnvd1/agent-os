/**
 * The account's rolling usage windows. The 5-hour one comes from the samples
 * in lib/orchestrator/usage.ts (AgentOS's own agents and the terminal
 * statusline, whichever is fresher), which also give its burn rate; the
 * weekly one from the readings AgentOS's agents store, else the plan's answer
 * to a short-lived agent start (no turn is spent), kept for a few minutes.
 * With nothing fresh, the last value seen is shown as such.
 */

import os from "os";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { InputQueue } from "../chat/queue";
import { readUsage, type LastSeen } from "../orchestrator/usage";
import {
  currentWindow,
  lastReading,
  parseRateLimit,
  recordReadings,
  type WindowReading,
} from "./rate-limits";

export interface WindowView {
  pct: number;
  // Seconds until it resets.
  resetsIn: number | null;
  // Seconds until it runs out at the current rate, when before it resets.
  capsIn?: number | null;
  burnPerMin?: number | null;
  // Worked out from recorded usage, not read from the account.
  estimated?: boolean;
  // Not sampled lately: the last value seen, and when (epoch ms).
  stale?: boolean;
  sampledAt?: number;
  // Seconds since then, when this was worked out.
  ageSec?: number;
}

export interface UsageWindows {
  fiveHour: WindowView | null;
  sevenDay: WindowView | null;
  // Why a window is missing.
  note?: string;
}

interface PlanWindow {
  utilization: number | null;
  resets_at: string | null;
}
interface PlanLimits {
  five_hour?: PlanWindow | null;
  seven_day?: PlanWindow | null;
}

const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;
interface Cached {
  at: number;
  limits: PlanLimits | null;
  error?: string;
}
let cache: Cached | null = null;
let inflight: Promise<Cached> | null = null;

async function askAgent(): Promise<PlanLimits | null> {
  const input = new InputQueue<SDKUserMessage>();
  const q = query({
    prompt: input,
    options: {
      cwd: os.homedir(),
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const usage = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("the agent didn't answer in time")),
          TIMEOUT_MS
        );
      }),
    ]);
    const limits = usage.rate_limits_available
      ? ((usage.rate_limits ?? null) as PlanLimits | null)
      : null;
    // A plan answer is a reading too: keep it for the screens and brakes.
    if (limits) recordReadings(parseRateLimit(limits), "plan");
    return limits;
  } finally {
    clearTimeout(timer);
    input.end();
    q.close();
  }
}

async function planLimits(): Promise<Cached> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  inflight ??= askAgent()
    .then((limits): Cached => ({ at: Date.now(), limits }))
    .catch((error: unknown): Cached => ({
      at: Date.now(),
      limits: null,
      error: error instanceof Error ? error.message : String(error),
    }))
    .then((c) => (cache = c))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function fromPlan(
  w: PlanWindow | null | undefined,
  nowMs = Date.now()
): WindowView | null {
  if (!w || typeof w.utilization !== "number") return null;
  const resets = w.resets_at ? Date.parse(w.resets_at) : NaN;
  return {
    pct: Math.round(w.utilization),
    resetsIn: Number.isFinite(resets)
      ? Math.max(0, Math.round((resets - nowMs) / 1000))
      : null,
  };
}

const fromReading = (
  r: WindowReading | null,
  nowMs: number
): WindowView | null =>
  r
    ? {
        pct: Math.round(r.pct),
        resetsIn: r.resetsAt
          ? Math.max(0, Math.round((r.resetsAt - nowMs) / 1000))
          : null,
        estimated: r.estimated || undefined,
      }
    : null;

// The last value seen, shown as such, while its window is still open.
export function fromLast(
  last: LastSeen | null | undefined,
  nowSec = Date.now() / 1000
): WindowView | null {
  if (!last || (last.resetsAt !== null && last.resetsAt <= nowSec)) return null;
  return {
    pct: last.pct,
    resetsIn:
      last.resetsAt === null ? null : Math.round(last.resetsAt - nowSec),
    stale: true,
    sampledAt: Math.round(last.sampledAt * 1000),
    ageSec: Math.max(0, Math.round(nowSec - last.sampledAt)),
  };
}

function lastWeekly(nowMs: number): WindowView | null {
  const r = lastReading("seven_day");
  return fromLast(
    r && {
      pct: Math.round(r.utilization),
      resetsAt: r.resetsAt === null ? null : r.resetsAt / 1000,
      sampledAt: r.at / 1000,
    },
    nowMs / 1000
  );
}

export async function usageWindows(): Promise<UsageWindows> {
  const sampled = readUsage();
  const read = (w: "five_hour" | "seven_day") => {
    try {
      const now = Date.now();
      return fromReading(currentWindow(w, now), now);
    } catch {
      return null;
    }
  };
  const plan = await planLimits();
  const fiveHour =
    "window" in sampled && sampled.window
      ? {
          pct: sampled.window.pct,
          resetsIn: sampled.window.resetsIn,
          capsIn: sampled.window.capsIn,
          burnPerMin: sampled.window.burnPerMin,
        }
      : (fromPlan(plan.limits?.five_hour) ??
        read("five_hour") ??
        ("unknown" in sampled ? fromLast(sampled.last) : null));
  let sevenDay: WindowView | null = null;
  try {
    sevenDay =
      fromPlan(plan.limits?.seven_day) ??
      read("seven_day") ??
      lastWeekly(Date.now());
  } catch {
    // No readings to show.
  }
  const note =
    "unknown" in sampled && (!fiveHour || fiveHour.stale)
      ? sampled.unknown
      : !sevenDay || !fiveHour
        ? (plan.error ?? "the plan's limits aren't available for this login")
        : undefined;
  return { fiveHour, sevenDay, note };
}
