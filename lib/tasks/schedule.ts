/**
 * The queue's scheduler, as pure functions: candidates and what we know about
 * the machine in, who starts and why the others wait out. Rules only, no model
 * and no clock of its own, so every case is a plain test.
 *
 * A candidate (a queued task, or a paused one that came due) first meets a
 * fixed list of holds; the first that applies is the reason shown. The ones
 * that pass are ordered by score: priority + age (capped) + a resume bonus.
 */

import {
  DEFAULT_PRIORITY,
  PRIORITY_LABEL,
  type Priority,
  type QueueExplainView,
} from "./schedule-types";
import {
  PRIORITY_POINTS,
  holdsFor,
  type Hold,
  type MachineView,
} from "./holds";

export { PRIORITIES, DEFAULT_PRIORITY } from "./schedule-types";
export type { Priority, WaitCode } from "./schedule-types";
export {
  AMBER_MIN_PRIORITY,
  HEAVY_START_GAP_MS,
  LOAD_SETTLE_MS,
  PRIORITY_POINTS,
  START_GAP_MS,
  machineHold,
  slotText,
  type Hold,
  type MachineLevel,
  type MachineView,
} from "./holds";

export const AGE_POINTS_PER_MIN = 0.5;
// Reached after five hours of waiting.
export const AGE_CAP = 150;
export const RESUME_BONUS = 150;
export interface Candidate {
  id: string;
  kind: "start" | "resume";
  // The line it is in: a workspace, or the project without one.
  group: string;
  priority: Priority;
  // The existing line order; breaks ties.
  position: number;
  // When it started waiting (queued, or came due to resume).
  waitingSinceMs: number;
  // Boots a simulator.
  heavy: boolean;
  // Needs something the machine it would start on can't give (a Mac).
  needsUnmet: boolean;
  // Starts on another machine: this one's load doesn't matter to it.
  remote: boolean;
  // A plan-only task before approval: it reads code and writes one file, so
  // load, spacing and the slot limit don't apply. Pause and `after` still do.
  planOnly?: boolean;
  // `after X` hold, from the caller (it needs the database).
  before: Hold | null;
  // Orchestrator Pause and the usage window, which hold after `after`.
  auto: Hold | readonly Hold[] | null;
  // "After any": its set, the ones that have finished, the ones other waiters
  // already used, and whether it was already released (a retry).
  any: {
    ids: string[];
    finished: string[];
    used: string[];
    released: boolean;
    label: string;
  } | null;
}

export interface Group {
  inFlight: number;
  limit: number;
}

export interface Plan {
  start: string[];
  // The finish an "after any" waiter takes, by candidate id (null: none left).
  consume: Map<string, string | null>;
  explain: Map<string, QueueExplainView>;
  // Every hold on each candidate, in order (empty: it starts).
  holds: Map<string, Hold[]>;
}

export function scoreParts(
  c: Pick<Candidate, "kind" | "priority" | "waitingSinceMs">,
  now: number
) {
  const minutes = Math.max(0, (now - c.waitingSinceMs) / 60_000);
  const priority =
    PRIORITY_POINTS[c.priority] ?? PRIORITY_POINTS[DEFAULT_PRIORITY];
  const age = Math.min(AGE_CAP, AGE_POINTS_PER_MIN * minutes);
  const resume = c.kind === "resume" ? RESUME_BONUS : 0;
  return { priority, age, resume, score: priority + age + resume };
}

export function priorityWord(priority: Priority): string {
  return PRIORITY_LABEL[priority];
}

// One look at the line. Candidates in, who starts and every row's reason out.
export function planStarts(
  candidates: Candidate[],
  groups: Map<string, Group>,
  machine: MachineView,
  now: number
): Plan {
  const plan: Plan = {
    start: [],
    consume: new Map(),
    explain: new Map(),
    holds: new Map(),
  };
  const m: MachineView = { ...machine };
  const byGroup = new Map<string, Candidate[]>();
  for (const c of candidates)
    byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  const used = new Set<string>();
  for (const c of candidates) for (const id of c.any?.used ?? []) used.add(id);

  for (const [key, list] of byGroup) {
    const group = groups.get(key) ?? { inFlight: 0, limit: Infinity };
    let inFlight = group.inFlight;
    const scored = list
      .map((c) => ({ c, ...scoreParts(c, now) }))
      .sort((a, b) => b.score - a.score || a.c.position - b.c.position);
    scored.forEach(({ c, score }, index) => {
      const holds = holdsFor(c, {
        machine: m,
        now,
        used,
        inFlight,
        limit: group.limit,
        rank: index + 1,
        of: scored.length,
      });
      const hold = holds[0] ?? null;
      plan.holds.set(c.id, holds);
      plan.explain.set(c.id, {
        code: hold?.code ?? null,
        text: hold?.text ?? null,
        score: Math.round(score * 10) / 10,
        rank: index + 1,
        of: scored.length,
        priority: c.priority,
      });
      if (hold) return;
      // Passed every hold: it starts.
      if (c.any && !c.any.released) {
        const free = c.any.finished.find((id) => !used.has(id)) ?? null;
        if (free) used.add(free);
        plan.consume.set(c.id, free);
      }
      if (!c.planOnly) inFlight += 1;
      if (!c.remote && !c.planOnly) {
        m.lastAutoStartAt = now;
        if (c.heavy) {
          m.lastHeavyStartAt = now;
          m.heavyStarting += 1;
        }
      }
      plan.start.push(c.id);
    });
  }
  return plan;
}
