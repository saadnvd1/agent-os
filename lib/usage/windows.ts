/**
 * The account's rolling usage windows. The 5-hour one comes from the
 * statusline's samples (lib/orchestrator/usage.ts), which also give its burn
 * rate; the weekly one only the agent knows, so it's asked through a
 * short-lived agent start (no turn is spent) and kept for a few minutes.
 */

import os from "os";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { InputQueue } from "../chat/queue";
import { readUsage } from "../orchestrator/usage";

export interface WindowView {
  pct: number;
  // Seconds until it resets.
  resetsIn: number | null;
  // Seconds until it runs out at the current rate, when before it resets.
  capsIn?: number | null;
  burnPerMin?: number | null;
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
    return usage.rate_limits_available ? (usage.rate_limits ?? null) : null;
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
    .catch(
      (error: unknown): Cached => ({
        at: Date.now(),
        limits: null,
        error: error instanceof Error ? error.message : String(error),
      })
    )
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

export async function usageWindows(): Promise<UsageWindows> {
  const sampled = readUsage();
  const plan = await planLimits();
  const fiveHour =
    "window" in sampled && sampled.window
      ? {
          pct: sampled.window.pct,
          resetsIn: sampled.window.resetsIn,
          capsIn: sampled.window.capsIn,
          burnPerMin: sampled.window.burnPerMin,
        }
      : fromPlan(plan.limits?.five_hour);
  const sevenDay = fromPlan(plan.limits?.seven_day);
  const note =
    !sevenDay || !fiveHour
      ? (plan.error ??
        ("unknown" in sampled
          ? sampled.unknown
          : "the plan's limits aren't available for this login"))
      : undefined;
  return { fiveHour, sevenDay, note };
}
