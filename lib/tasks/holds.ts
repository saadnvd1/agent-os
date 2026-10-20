/**
 * Every reason a task waits, as one type and one ordered list. A hold is
 * pure data: `holdsFor` turns a candidate and what we know of its machine
 * into the holds that apply, always in HOLD_ORDER, and the first is the
 * reason shown. The queue view, a queued row's note, a paused task's resume
 * note and the start decision all read that list, so "why is this waiting"
 * has one source. No database and no clock of its own: the checks that need
 * either are in hold-checks.ts.
 */

import {
  DEFAULT_PRIORITY,
  type Priority,
  type WaitCode,
} from "./schedule-types";
import type { Candidate } from "./schedule";

// Out of red this long before automatic starts resume.
export const LOAD_SETTLE_MS = 120_000;
// On amber, only this priority and above start.
export const AMBER_MIN_PRIORITY: Priority = "blocking";
// Between automatic starts on one machine.
export const START_GAP_MS = 60_000;
// Between starts of tasks that boot a simulator.
export const HEAVY_START_GAP_MS = 5 * 60_000;

export const PRIORITY_POINTS: Record<Priority, number> = {
  urgent: 400,
  blocking: 300,
  normal: 200,
  background: 100,
};
const priorityRank = (p: Priority) => PRIORITY_POINTS[p] ?? 0;

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

export type MachineCode =
  "needs" | "load_red" | "load_amber" | "heavy" | "spacing";

// A reason a task isn't starting. `code` is also what a queue row stores and
// the client reads. A hold that rests on a machine says which one, and when
// it knows, the time (ms) it lifts.
export type Hold =
  | { code: "after"; text: string }
  | { code: "after_any"; text: string }
  | { code: "after_claim"; text: string }
  | { code: "orch_paused"; text: string }
  | { code: "window"; text: string }
  | {
      code: MachineCode;
      text: string;
      machine: string;
      until?: number;
      // Why it waits here instead of starting on a linked machine.
      stay?: string;
    }
  | { code: "slot"; text: string };

// The order holds are reported in; the first that applies is the reason.
export const HOLD_ORDER: readonly WaitCode[] = [
  "after",
  "after_any",
  "after_claim",
  "orch_paused",
  "window",
  "needs",
  "load_red",
  "load_amber",
  "heavy",
  "spacing",
  "slot",
];

// Whether the hold lifts without anyone acting. A Pause is lifted by a
// person, and a task that needs a Mac never gets one by waiting.
const CLEARS_BY_ITSELF: Record<WaitCode, boolean> = {
  after: true,
  after_any: true,
  after_claim: true,
  orch_paused: false,
  window: true,
  needs: false,
  load_red: true,
  load_amber: true,
  heavy: true,
  spacing: true,
  slot: true,
};

export const clearsByItself = (h: Hold): boolean => CLEARS_BY_ITSELF[h.code];

// The holds a linked machine could lift by taking the start.
const PLACEABLE = new Set<WaitCode>([
  "load_red",
  "load_amber",
  "heavy",
  "needs",
]);

export const placeable = (h: Pick<Hold, "code">): boolean =>
  PLACEABLE.has(h.code);

// The text a person sees: the hold, and for a task that can't go elsewhere,
// why it stays here.
export function holdText(h: Hold): string {
  return "stay" in h && h.stay ? `${h.text} (${h.stay})` : h.text;
}

// The same without the "Waiting: " lead, for a note that has its own.
export const holdReason = (h: Hold): string =>
  holdText(h).replace(/^Waiting: /, "");

// What a row stores of its first hold: null code and text when none.
export function queueNote(holds: readonly Hold[] | undefined): {
  code: WaitCode | null;
  text: string | null;
} | null {
  if (!holds) return null;
  const head = holds[0];
  return head
    ? { code: head.code, text: holdText(head) }
    : { code: null, text: null };
}

// What a timed resume waiting for its turn says on its task.
export function resumeNote(
  holds: readonly Hold[] | undefined,
  slots: { running: number; limit: number | null }
): string | null {
  if (!holds) return null;
  const head = holds[0];
  if (head && head.code !== "slot") return `held: ${holdReason(head)}`;
  return slots.limit === null
    ? "resuming: waiting for its turn"
    : `resuming: waiting for a slot, ${slots.running} of ${slots.limit} running`;
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export function slotText(rank: number, of: number, priority: Priority): string {
  const word = priority === DEFAULT_PRIORITY ? "" : ` · ${priority}`;
  return `#${rank} of ${of}${word}`;
}

type MachineAsk = Pick<
  Candidate,
  "heavy" | "needsUnmet" | "remote" | "priority"
> &
  Partial<Pick<Candidate, "planOnly">>;

// The holds the machine puts on a start, in order. Empty: it may start here
// now. A machine with no reading yet says only that; one with load checks
// off says only what it lacks.
export function machineHolds(
  c: MachineAsk,
  m: MachineView,
  now: number
): Hold[] {
  if (c.remote || c.planOnly) return [];
  const out: Hold[] = [];
  const add = (code: MachineCode, text: string, until?: number): void => {
    out.push({
      code,
      text: `Waiting: ${text}`,
      machine: m.label,
      ...(until === undefined ? {} : { until }),
    });
  };
  if (c.needsUnmet) add("needs", "needs a Mac");
  if (!m.enabled) return out;
  if (m.reading) {
    add("load_red", "reading machine load");
    return out;
  }
  if (m.level === "red") add("load_red", `${m.label} load red`);
  else if (!m.settled)
    add(
      "load_red",
      `${m.label} load was red; calm for ${seconds(m.settleLeftMs)}s more`,
      now + m.settleLeftMs
    );
  else if (
    m.level === "amber" &&
    priorityRank(c.priority) < priorityRank(AMBER_MIN_PRIORITY)
  )
    add(
      "load_amber",
      `${m.label} load amber; ${c.priority} work starts on green`
    );
  if (c.heavy && m.level !== "red") {
    if (m.level !== "green")
      add("heavy", `${m.label} load amber; simulator work starts on green`);
    else if (m.heavyStarting > 0)
      add("heavy", `a simulator is booting on ${m.label}`);
    else if (m.booted >= m.maxBooted)
      add("heavy", `${m.booted} of ${m.maxBooted} simulators in use`);
    else if (
      m.lastHeavyStartAt !== null &&
      now - m.lastHeavyStartAt < HEAVY_START_GAP_MS
    )
      add(
        "heavy",
        `a simulator task just started on ${m.label} (next in ${seconds(HEAVY_START_GAP_MS - (now - m.lastHeavyStartAt))}s)`,
        m.lastHeavyStartAt + HEAVY_START_GAP_MS
      );
  }
  if (m.lastAutoStartAt !== null && now - m.lastAutoStartAt < START_GAP_MS)
    add(
      "spacing",
      `spacing starts (next in ${seconds(START_GAP_MS - (now - m.lastAutoStartAt))}s)`,
      m.lastAutoStartAt + START_GAP_MS
    );
  return out;
}

// The first machine hold, or null: the one every placement check asks.
export const machineHold = (
  c: MachineAsk,
  m: MachineView,
  now: number
): Hold | null => machineHolds(c, m, now)[0] ?? null;

export interface HoldContext {
  machine: MachineView;
  now: number;
  // Finishes other waiters have already taken this look.
  used: ReadonlySet<string>;
  // Running tasks in its line, and the line's limit.
  inFlight: number;
  limit: number;
  // Its place in the line's score order.
  rank: number;
  of: number;
}

// Every hold on a candidate, in HOLD_ORDER. The first is why it waits; none:
// it starts.
export function holdsFor(c: Candidate, ctx: HoldContext): Hold[] {
  const out: Hold[] = [];
  if (c.before) out.push(c.before);
  if (c.any && !c.any.released) {
    const free = c.any.finished.some((id) => !ctx.used.has(id));
    const spent =
      c.any.ids.length > 0 && c.any.finished.length === c.any.ids.length;
    if (!free && !spent)
      out.push({
        code: "after_any",
        text: `Waiting: after any running task (${c.any.label})`,
      });
  }
  if (c.auto) out.push(...([] as Hold[]).concat(c.auto));
  out.push(...machineHolds(c, ctx.machine, ctx.now));
  if (!c.planOnly && ctx.inFlight >= ctx.limit)
    out.push({
      code: "slot",
      text: slotText(ctx.rank, ctx.of, c.priority),
    });
  return out;
}
