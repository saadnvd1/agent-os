/**
 * The health tick: once a minute, on the orchestrator watcher's own tick,
 * read one snapshot, run the checks, record what they found, and wake a
 * watcher for each anomaly that is new or got worse. All of it but the wake
 * is plain code; with nothing wrong, a tick costs no tokens.
 */

import { runClaude } from "../orchestrator/claude-cli";
import { lastDeployRestart, leaveHeartbeat, markDeployBoot } from "./boots";
import { healthConfig, type HealthConfig } from "./config";
import { runDetectors } from "./detectors";
import { gatherFacts, liveBackgroundJobs } from "./facts";
import { envTick, realEnv, type EnvDeps } from "./env/envTick";
import { portWaitTick } from "./port-wait-tick";
import { spinTick } from "./spin-tick";
import { addNote } from "./notes";
import { closeResolvedPieces } from "./pieces";
import { deliver, deliverClosed, type RouteDeps, realRoute } from "./route";
import {
  markWoken,
  needsWake,
  openAnomalies,
  recordTrips,
  saveVerdict,
  anomaly,
} from "./store";
import {
  currentUsagePct,
  unjudged,
  wake,
  type WakeResult,
  type WatchDeps,
} from "./watchers";
import {
  CHECKS,
  MIN,
  type AnomalyRow,
  type CheckId,
  type HealthFacts,
} from "./types";

export const EVERY_MS = MIN;
// Watchers running at once; the rest wait for the next tick.
export const MAX_WAKES = 2;
// A wake that never came back (a restart cut it off) is given up on.
export const WAKE_GIVE_UP_MS = 3 * MIN;

// The checks the tick evaluates: piece-dup is raised where a piece starts,
// bg-spin and port-wait by the process steps (spin-tick.ts, port-wait-tick.ts).
export const TICK_CHECKS: readonly CheckId[] = CHECKS.filter(
  (c) => c !== "piece-dup" && c !== "bg-spin" && c !== "port-wait"
);

export interface TickDeps {
  config: () => HealthConfig;
  facts: (now: number, c: HealthConfig) => HealthFacts;
  watch: WatchDeps;
  route: RouteDeps;
  env: EnvDeps;
  // Stops background jobs that spin (spin-tick.ts).
  spin: (now: number) => Promise<void>;
  // Tells agents that wait on a port someone else holds (port-wait-tick.ts).
  portWait: (now: number, c: HealthConfig) => Promise<void>;
  wake: typeof wake;
}

export const realTick: TickDeps = {
  config: healthConfig,
  facts: gatherFacts,
  watch: { run: runClaude, usagePct: currentUsagePct },
  route: realRoute,
  env: realEnv,
  spin: spinTick,
  portWait: portWaitTick,
  wake,
};

const inFlight = new Set<number>();
let last = 0;

export function resetTick(): void {
  last = 0;
  inFlight.clear();
}

function finish(
  row: AnomalyRow,
  result: WakeResult,
  now: number,
  deps: TickDeps
): void {
  saveVerdict(row.id, result.verdict, result.tokens);
  const fresh = anomaly(row.id);
  if (!fresh) return;
  // A verdict that says it's normal teaches the area what normal is.
  if (!result.verdict.real && result.verdict.note)
    addNote(row.area, result.verdict.note, "watcher", now);
  deliver(fresh, result.verdict, now, deps.route);
}

async function wakeOne(
  row: AnomalyRow,
  facts: HealthFacts,
  c: HealthConfig,
  deps: TickDeps
): Promise<void> {
  inFlight.add(row.id);
  try {
    const result = await deps.wake(row, facts, c, deps.watch);
    finish(row, result, Date.now(), deps);
  } catch (error) {
    console.error(`[health] watcher for #${row.id} failed:`, error);
    finish(
      row,
      { verdict: unjudged(row, "the watcher failed"), tokens: null },
      Date.now(),
      deps
    );
  } finally {
    inFlight.delete(row.id);
  }
}

// Anomalies whose wake was cut off get their own words delivered.
function giveUpStale(now: number, deps: TickDeps): void {
  for (const row of openAnomalies()) {
    if (row.woken_at === null || row.verdict !== null) continue;
    if (inFlight.has(row.id) || now - row.woken_at < WAKE_GIVE_UP_MS) continue;
    finish(
      row,
      { verdict: unjudged(row, "the watcher was cut off"), tokens: null },
      now,
      deps
    );
  }
}

// Returns once the synchronous part is done; wakes run on in the background.
export function healthTick(
  now = Date.now(),
  deps: TickDeps = realTick
): Promise<void>[] {
  if (now - last < EVERY_MS) return [];
  last = now;
  const c = deps.config();
  try {
    markDeployBoot(lastDeployRestart());
  } catch (error) {
    console.error("[health] deploy restarts:", error);
  }
  const facts = deps.facts(now, c);
  const found = recordTrips(runDetectors(facts, c), TICK_CHECKS, now);
  for (const row of found.closed) deliverClosed(row, now, deps.route);
  closeResolvedPieces(now);
  leaveHeartbeat(now, liveBackgroundJobs());
  giveUpStale(now, deps);
  void deps
    .spin(now)
    .catch((error) => console.error("[health] spin check:", error));
  void deps
    .portWait(now, c)
    .catch((error) => console.error("[health] port-wait check:", error));
  void envTick(now, c, deps.env).catch((error) =>
    console.error("[health] environment failures:", error)
  );

  const running: Promise<void>[] = [];
  for (const row of openAnomalies()) {
    if (!needsWake(row) || inFlight.has(row.id)) continue;
    if (inFlight.size >= MAX_WAKES) break;
    markWoken(row.id, row.severity, now);
    running.push(wakeOne(row, facts, c, deps));
  }
  return running;
}
