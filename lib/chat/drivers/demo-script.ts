/**
 * The demo's scripted running turn: typed into a demo chat, it holds a state
 * a screenshot needs (a tool streaming partial output, a long wait on the
 * model, a retry) for a set time, then finishes. Demo only: the demo driver
 * is the one place that reads it (AGENTOS_DEMO=1; no real session gets here).
 *
 *     demo: running turn [step|wait|retry|compact|stalled|empty] [hold=<seconds>]
 *
 * compact holds a compaction; stalled and empty end the turn the way a stalled
 * model request and an empty reply after compaction do (with a Retry).
 */

import type { DriverEvent, TurnEndReason } from "../events";
import { COMPACTION_EMPTY_NOTICE, stalledNotice } from "./turn-outcome";

export type DemoPhase =
  "step" | "wait" | "retry" | "compact" | "stalled" | "empty";

export interface DemoScript {
  // Hold only this state; none runs all three, one after the other.
  phase?: DemoPhase;
  holdMs: number;
}

export const DEFAULT_HOLD_S = 30;
export const MAX_HOLD_S = 120;
const TRIGGER =
  /^demo: running turn(?: (step|wait|retry|compact|stalled|empty))?(?: hold=(\d+))?$/;

export function parseDemoScript(text: string): DemoScript | null {
  const m = TRIGGER.exec(text.trim());
  if (!m) return null;
  const seconds = m[2] === undefined ? DEFAULT_HOLD_S : Number(m[2]);
  return {
    phase: m[1] as DemoPhase | undefined,
    holdMs: Math.min(seconds, MAX_HOLD_S) * 1000,
  };
}

export const DEMO_SCRIPT_PROMPT =
  "Run the checkout tests and fix whatever fails.";

const COMMAND = "npx vitest run src/checkout";
const LINES = [
  " RUN  v3.2.4 ~/code/storefront",
  " ✓ src/checkout/discount.test.ts (6 tests) 12ms",
  " ✓ src/checkout/tax.test.ts (9 tests) 18ms",
  " ✓ src/checkout/cart.test.ts (14 tests) 41ms",
  " ✓ src/checkout/shipping.test.ts (8 tests) 22ms",
  " ✓ src/checkout/coupons.test.ts (11 tests) 35ms",
  " ✓ src/checkout/currency.test.ts (7 tests) 9ms",
  " ❯ src/checkout/totals.test.ts (12 tests | 1 running)",
];

export interface ScriptRun {
  push: (e: DriverEvent) => void;
  stopped: () => boolean;
  sleep: (ms: number) => Promise<void>;
}

// Waits `ms`, in slices so an interrupt ends it.
async function hold(run: ScriptRun, ms: number) {
  for (let left = ms; left > 0 && !run.stopped(); left -= 100)
    await run.sleep(Math.min(100, left));
}

async function runningStep(run: ScriptRun, id: string, holdMs: number) {
  const tool = {
    id,
    kind: "tool" as const,
    name: "Bash",
    title: COMMAND,
    input: { command: COMMAND },
    createdAt: Date.now(),
  };
  const show = (n: number) =>
    run.push({
      type: "item",
      item: {
        ...tool,
        status: "running",
        output: LINES.slice(0, Math.max(1, n)).join("\n"),
      },
    });
  // A line every half second, then the last line stays until the hold ends.
  const end = Date.now() + holdMs;
  show(1);
  for (let n = 2; n <= LINES.length && !run.stopped(); n++) {
    if (Date.now() >= end) break;
    await hold(run, 500);
    show(n);
  }
  await hold(run, Math.max(0, end - Date.now()));
  const stopped = run.stopped();
  run.push({
    type: "item",
    item: {
      ...tool,
      status: stopped ? "stopped" : "done",
      output: stopped
        ? undefined
        : `${LINES.slice(0, -1).join("\n")}\n 1 passed`,
      endedAt: Date.now(),
    },
  });
}

// A compaction of a big context, held, then done.
async function compacting(run: ScriptRun, holdMs: number) {
  run.push({ type: "compacting", active: true });
  await hold(run, holdMs);
  run.push({ type: "compacting", active: false });
}

export async function runDemoScript(
  script: DemoScript,
  run: ScriptRun,
  runId = String(Date.now())
): Promise<void> {
  const started = Date.now();
  const phases: DemoPhase[] = script.phase
    ? [script.phase]
    : ["step", "wait", "retry"];
  // The end of a turn that stopped short, after one finished step.
  const ending: { reason: TurnEndReason; notice: string } | undefined =
    script.phase === "stalled"
      ? { reason: "stalled", notice: stalledNotice(22 * 60_000, false) }
      : script.phase === "empty"
        ? { reason: "compaction_empty", notice: COMPACTION_EMPTY_NOTICE }
        : undefined;
  run.push({ type: "state", state: "running" });
  run.push({ type: "turn_start" });
  run.push({
    type: "item",
    item: {
      id: `demo-a-${runId}`,
      kind: "assistant",
      text: "I'll run the checkout tests first.",
      createdAt: started,
    },
  });
  run.push({ type: "prompt_tokens", tokens: 48_200 });
  for (const phase of phases) {
    if (run.stopped()) break;
    if (phase === "step")
      await runningStep(run, `demo-t-${runId}`, script.holdMs);
    else if (phase === "stalled" || phase === "empty") {
      await runningStep(run, `demo-t-${runId}`, 0);
      if (phase === "empty") await compacting(run, script.holdMs);
      else await hold(run, script.holdMs);
    } else if (phase === "compact") await compacting(run, script.holdMs);
    else {
      if (phase === "retry")
        run.push({
          type: "model_retry",
          attempt: 2,
          message: "The model is overloaded",
        });
      await hold(run, script.holdMs);
    }
  }
  run.push({
    type: "item",
    item: {
      id: `demo-end-${runId}`,
      kind: "turn_end",
      durationMs: Date.now() - started,
      interrupted: run.stopped() || undefined,
      ended: run.stopped() ? undefined : ending,
      createdAt: Date.now(),
    },
  });
  run.push({ type: "state", state: "idle" });
}
