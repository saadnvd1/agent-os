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
  type WaitCode,
} from "./schedule-types";

export { PRIORITIES, DEFAULT_PRIORITY } from "./schedule-types";
export type { Priority, WaitCode } from "./schedule-types";

export const PRIORITY_POINTS: Record<Priority, number> = {
  urgent: 400,
  blocking: 300,
  normal: 200,
  background: 100,
};
export const AGE_POINTS_PER_MIN = 0.5;
// Reached after five hours of waiting.
export const AGE_CAP = 150;
export const RESUME_BONUS = 150;
// Out of red this long before automatic starts resume.
export const LOAD_SETTLE_MS = 120_000;
// On amber, only this priority and above start.
export const AMBER_MIN_PRIORITY: Priority = "blocking";
// Between automatic starts on one machine.
export const START_GAP_MS = 60_000;
// Between starts of tasks that boot a simulator.
export const HEAVY_START_GAP_MS = 5 * 60_000;

export type MachineLevel = "green" | "amber" | "red";

// What the machine a candidate would start on looks like right now.
export interface MachineView {
  // Shown in hold texts, e.g. "this machine".
  label: string;
  // False: no load holds at all (AGENTOS_LOAD=off).
  enabled: boolean;
  // No sample read yet since AgentOS started.
  reading: boolean;
  level: MachineLevel;
  // Not red, and calm for LOAD_SETTLE_MS since it last was.
  settled: boolean;
  // Seconds of calm still needed, when not settled and not red.
  settleLeftMs: number;
  booted: number;
  maxBooted: number;
  // Heavy tasks started within HEAVY_START_GAP_MS that hold no lease yet.
  heavyStarting: number;
  lastAutoStartAt: number | null;
  lastHeavyStartAt: number | null;
}

export interface Hold {
  code: WaitCode;
  text: string;
}

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
  // `after X` hold, from the caller (it needs the database).
  before: Hold | null;
  // Orchestrator Pause and the usage window, which hold after `after`.
  auto: Hold | null;
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

const priorityRank = (p: Priority) => PRIORITY_POINTS[p] ?? 0;

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

// The machine holds, in order. Null: it may start here now.
export function machineHold(
  c: Pick<Candidate, "heavy" | "needsUnmet" | "remote" | "priority">,
  m: MachineView,
  now: number
): Hold | null {
  if (c.remote) return null;
  if (c.needsUnmet) return { code: "needs", text: `Waiting: needs a Mac` };
  if (!m.enabled) return null;
  if (m.reading)
    return { code: "load_red", text: "Waiting: reading machine load" };
  if (m.level === "red")
    return { code: "load_red", text: `Waiting: ${m.label} load red` };
  if (!m.settled)
    return {
      code: "load_red",
      text: `Waiting: ${m.label} load was red; calm for ${seconds(m.settleLeftMs)}s more`,
    };
  if (
    m.level === "amber" &&
    priorityRank(c.priority) < priorityRank(AMBER_MIN_PRIORITY)
  )
    return {
      code: "load_amber",
      text: `Waiting: ${m.label} load amber; ${c.priority} work starts on green`,
    };
  if (c.heavy) {
    if (m.level !== "green")
      return {
        code: "heavy",
        text: `Waiting: ${m.label} load amber; simulator work starts on green`,
      };
    if (m.heavyStarting > 0)
      return {
        code: "heavy",
        text: `Waiting: a simulator is booting on ${m.label}`,
      };
    if (m.booted >= m.maxBooted)
      return {
        code: "heavy",
        text: `Waiting: ${m.booted} of ${m.maxBooted} simulators in use`,
      };
    if (
      m.lastHeavyStartAt !== null &&
      now - m.lastHeavyStartAt < HEAVY_START_GAP_MS
    )
      return {
        code: "heavy",
        text: `Waiting: a simulator task just started on ${m.label} (next in ${seconds(HEAVY_START_GAP_MS - (now - m.lastHeavyStartAt))}s)`,
      };
  }
  if (m.lastAutoStartAt !== null && now - m.lastAutoStartAt < START_GAP_MS)
    return {
      code: "spacing",
      text: `Waiting: spacing starts (next in ${seconds(START_GAP_MS - (now - m.lastAutoStartAt))}s)`,
    };
  return null;
}

export function slotText(rank: number, of: number, priority: Priority): string {
  const word = priority === DEFAULT_PRIORITY ? "" : ` · ${priority}`;
  return `#${rank} of ${of}${word}`;
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
  const plan: Plan = { start: [], consume: new Map(), explain: new Map() };
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
    scored.forEach(({ c, score, priority: _p }, index) => {
      const rank = index + 1;
      const hold = holdOf(c);
      const view = (h: Hold | null): QueueExplainView => ({
        code: h?.code ?? null,
        text: h?.text ?? null,
        score: Math.round(score * 10) / 10,
        rank,
        of: scored.length,
        priority: c.priority,
      });
      if (hold) return void plan.explain.set(c.id, view(hold));
      if (inFlight >= group.limit)
        return void plan.explain.set(
          c.id,
          view({
            code: "slot",
            text: slotText(rank, scored.length, c.priority),
          })
        );
      // Passed every hold: it starts.
      if (c.any && !c.any.released) {
        const free = c.any.finished.find((id) => !used.has(id)) ?? null;
        if (free) used.add(free);
        plan.consume.set(c.id, free);
      }
      inFlight += 1;
      if (!c.remote) {
        m.lastAutoStartAt = now;
        if (c.heavy) {
          m.lastHeavyStartAt = now;
          m.heavyStarting += 1;
        }
      }
      plan.start.push(c.id);
      plan.explain.set(c.id, view(null));
    });
  }
  return plan;

  function holdOf(c: Candidate): Hold | null {
    if (c.before) return c.before;
    if (c.any && !c.any.released) {
      const free = c.any.finished.some((id) => !used.has(id));
      const spent =
        c.any.ids.length > 0 && c.any.finished.length === c.any.ids.length;
      if (!free && !spent)
        return {
          code: "after_any",
          text: `Waiting: after any running task (${c.any.label})`,
        };
    }
    return c.auto ?? machineHold(c, m, now);
  }
}
