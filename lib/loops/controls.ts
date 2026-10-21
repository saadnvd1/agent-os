import { getProject } from "../projects";
import { queueEventOnce } from "../orchestrator/events";
import { resolveAsks, taskSubject } from "../orchestrator/asks";
import { defaultDeps, type LoopDeps } from "./deps";
import { callHook } from "./hooks";
import { cycleInFlight, deliverCycle } from "./runCycle";
import { screenInstruction } from "./screenInstruction";
import { finishLoop } from "./stopLoop";
import {
  addCriteria,
  criteriaOf,
  cyclesOf,
  editCriterion,
  getCycle,
  insertLoop,
  latestLoopFor,
  liveLoopFor,
  moveCycle,
  patchCycle,
  removeCriterion,
  reopenLoop,
  setLimits,
  setRunNow,
  waiveCriterion,
} from "./store";
import {
  CRITERION_SOURCES,
  DEFAULT_LIMITS,
  LIMIT_BOUNDS,
  LoopError,
  type CriterionDraft,
  type Limits,
  type LoopRow,
  type LoopView,
} from "./types";

export const MAX_CRITERIA = 30;
export const CRITERION_MAX = 400;
export const INSTRUCTION_MAX = 8000;

export function cleanCriteria(drafts: CriterionDraft[]): CriterionDraft[] {
  const out = drafts
    .map((d) => ({
      text: String(d.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, CRITERION_MAX),
      source: CRITERION_SOURCES.includes(d.source as never) ? d.source : "user",
      evidenceKind: d.evidenceKind ?? null,
    }))
    .filter((d) => d.text);
  if (!out.length)
    throw new LoopError("Add at least one acceptance criterion", 400);
  if (out.length > MAX_CRITERIA)
    throw new LoopError(`At most ${MAX_CRITERIA} criteria`, 400);
  return out as CriterionDraft[];
}

// Limits inside their bounds; a value out of range is refused, not clamped.
export function cleanLimits(
  input: Partial<Limits> = {},
  base: Limits = DEFAULT_LIMITS
): Limits {
  const out = { ...base };
  for (const key of Object.keys(LIMIT_BOUNDS) as (keyof Limits)[]) {
    const v = input[key];
    if (v === undefined) continue;
    const [lo, hi] = LIMIT_BOUNDS[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)
      throw new LoopError(`${key} must be between ${lo} and ${hi}`, 400);
    out[key] = key === "maxCostUsd" ? v : Math.round(v);
  }
  return out;
}

const workspaceOf = (task: {
  project_id: string | null;
  workspace_id: string | null;
}) =>
  (task.project_id && getProject(task.project_id)?.workspace_id) ||
  task.workspace_id ||
  null;

function runningTask(deps: LoopDeps, taskId: string) {
  const task = deps.task(taskId);
  if (!task) throw new LoopError("No such task", 404);
  if (task.task_status !== "running")
    throw new LoopError("The task isn't running", 409);
  if (task.quick_of)
    throw new LoopError("A quick change has no agent to loop with", 409);
  if (task.host_id && task.host_id !== "local")
    throw new LoopError(
      "The task runs on another machine: start the loop there",
      409
    );
  return task;
}

export async function startLoop(
  taskId: string,
  input: { criteria: CriterionDraft[]; limits?: Partial<Limits> },
  deps: LoopDeps = defaultDeps
): Promise<LoopView> {
  const task = runningTask(deps, taskId);
  if (liveLoopFor(taskId))
    throw new LoopError("A loop is already running on this task", 409);
  const criteria = cleanCriteria(input.criteria);
  const limits = cleanLimits(input.limits);
  // A loop with no checks is the coder's claims again.
  const prepared = await deps.prepare(task).catch((e: Error) => {
    throw new LoopError(`Can't read the task's repository: ${e.message}`, 409);
  });
  const commands = await deps.commands(prepared.repo, prepared.base);
  if (!commands.test && !commands.typecheck)
    throw new LoopError(
      "The base branch has no test command in agentos.json: add one so the loop has evidence to judge by",
      409
    );
  const workspaceId = workspaceOf(task);
  const now = deps.now();
  const loop = insertLoop({
    sessionId: taskId,
    workspaceId,
    goal: (task.task_prompt ?? "").slice(0, 20_000),
    limits,
    costBaseUsd: 0,
    now,
  });
  addCriteria(loop.id, criteria);
  if (workspaceId) {
    resolveAsks(workspaceId, taskSubject(taskId), "a new loop started");
    queueEventOnce(
      workspaceId,
      `loop:${taskId}:${loop.id}:started`,
      taskId,
      `Loop started on ${task.name}: ${criteria.length} criteria, up to ${limits.maxCycles} cycles.`
    );
  }
  callHook("onStart", loop);
  return loopView(taskId, deps)!;
}

export function stopByUser(
  taskId: string,
  deps: LoopDeps = defaultDeps
): LoopView {
  const loop = liveLoopFor(taskId);
  if (!loop) throw new LoopError("No loop is running on this task", 409);
  const task = deps.task(taskId);
  finishLoop(
    loop,
    { reason: "stopped", detail: "stopped by you" },
    { taskName: task?.name ?? "the task", now: deps.now() }
  );
  return loopView(taskId, deps)!;
}

export interface EditInput {
  limits?: Partial<Limits>;
  // Added on top of the current limits.
  extend?: { cycles?: number; costUsd?: number; minutes?: number };
  addCriteria?: CriterionDraft[];
  editCriteria?: { id: number; text: string }[];
  removeCriteria?: number[];
  waive?: number[];
}

// Limits, extensions and criteria, on a running loop or one stopped on a
// limit (an extension that clears the limit runs it again).
export function editLoop(
  taskId: string,
  input: EditInput,
  by = "you",
  deps: LoopDeps = defaultDeps
): LoopView {
  const loop = latestLoopFor(taskId);
  if (!loop) throw new LoopError("This task has no loop", 404);
  if (input.limits) setLimits(loop.id, cleanLimits(input.limits, loop));
  if (input.extend) {
    const e = input.extend;
    const next = cleanLimits(
      {
        maxCycles: e.cycles ? loop.maxCycles + e.cycles : undefined,
        maxCostUsd: e.costUsd ? loop.maxCostUsd + e.costUsd : undefined,
        maxMinutes: e.minutes ? loop.maxMinutes + e.minutes : undefined,
      },
      loop
    );
    setLimits(loop.id, next);
    if (loop.state === "stopped" && loop.stopReason?.startsWith("limit:"))
      resume(loop, deps);
  }
  if (input.addCriteria?.length) {
    const have = criteriaOf(loop.id).length;
    const add = cleanCriteria(input.addCriteria);
    if (have + add.length > MAX_CRITERIA)
      throw new LoopError(`At most ${MAX_CRITERIA} criteria`, 400);
    addCriteria(loop.id, add);
  }
  for (const c of input.editCriteria ?? []) {
    const text = String(c.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CRITERION_MAX);
    if (!text) throw new LoopError("A criterion can't be empty", 400);
    if (!editCriterion(c.id, loop.id, text))
      throw new LoopError("No such criterion", 404);
  }
  for (const id of input.removeCriteria ?? [])
    if (!removeCriterion(id, loop.id))
      throw new LoopError("No such criterion", 404);
  for (const id of input.waive ?? [])
    if (!waiveCriterion(id, loop.id, by))
      throw new LoopError("No such criterion", 404);
  if (input.removeCriteria?.length && !criteriaOf(loop.id).length)
    throw new LoopError("A loop needs at least one criterion", 400);
  return loopView(taskId, deps)!;
}

function resume(loop: LoopRow, deps: LoopDeps): void {
  const task = deps.task(loop.sessionId);
  if (!task || task.task_status !== "running")
    throw new LoopError("The task isn't running", 409);
  if (liveLoopFor(loop.sessionId)) return;
  if (!reopenLoop(loop.id)) return;
  setRunNow(loop.id, true);
  if (loop.workspaceId)
    resolveAsks(
      loop.workspaceId,
      taskSubject(loop.sessionId),
      "the loop was resumed"
    );
}

// Run now: a cycle at the next tick, resuming a stopped loop (after criteria
// were edited, say).
export function runNow(taskId: string, deps: LoopDeps = defaultDeps): LoopView {
  const loop = latestLoopFor(taskId);
  if (!loop) throw new LoopError("This task has no loop", 404);
  if (loop.state === "stopped") {
    if (loop.stopReason === "done")
      throw new LoopError("The loop is done", 409);
    resume(loop, deps);
  } else setRunNow(loop.id, true);
  return loopView(taskId, deps)!;
}

export type NextAction =
  | { action: "send"; instruction?: string }
  | { action: "hold" }
  | { action: "skip" };

// What the person does with the instruction in its countdown: send it now
// (edited or not), hold the countdown while they edit, or skip the cycle.
export async function actOnNext(
  taskId: string,
  input: NextAction,
  deps: LoopDeps = defaultDeps
): Promise<LoopView> {
  const loop = liveLoopFor(taskId);
  if (!loop) throw new LoopError("No loop is running on this task", 409);
  const task = deps.task(taskId);
  const cycle = cyclesOf(loop.id, { limit: 1 })[0];
  if (!task || !cycle || cycle.state !== "counting")
    throw new LoopError("No instruction is waiting to be sent", 409);
  if (input.action === "skip") {
    moveCycle(loop.id, cycle.n, ["counting"], {
      state: "skipped",
      endedAt: deps.now(),
    });
  } else if (input.action === "hold") {
    patchCycle(loop.id, cycle.n, { sendAt: null });
  } else {
    const edited = input.instruction?.trim();
    if (edited !== undefined && !edited)
      throw new LoopError("The instruction is empty", 400);
    if (edited && edited.length > INSTRUCTION_MAX)
      throw new LoopError("The instruction is too long", 400);
    if (edited && edited !== cycle.instruction?.trim()) {
      // The person may tell the coder what they like, but the loop still
      // sends nothing that crosses a hard line on its own.
      const refused = screenInstruction(edited);
      if (refused)
        throw new LoopError(
          `Not sent: ${refused.why}. Send it to the coder yourself if you mean it.`,
          409
        );
      patchCycle(loop.id, cycle.n, { instruction: edited, sender: "user" });
    }
    if (cycleInFlight(loop.id))
      throw new LoopError("The cycle is still being prepared", 409);
    await deliverCycle({ loop, task, facts: undefined, deps }, cycle.n);
  }
  return loopView(taskId, deps)!;
}

export function loopView(
  taskId: string,
  deps: LoopDeps = defaultDeps,
  opts: { before?: number } = {}
): LoopView | null {
  const loop = latestLoopFor(taskId);
  if (!loop) return null;
  const task = deps.task(taskId);
  const hold = loop.state === "running" && task ? deps.hold(loop, task) : null;
  return {
    loop,
    hold: hold?.kind ?? null,
    holdReason: hold?.reason ?? null,
    spentUsd: deps.spent(loop),
    elapsedMs: (loop.endedAt ?? deps.now()) - loop.startedAt,
    criteria: criteriaOf(loop.id),
    cycles: cyclesOf(loop.id, { before: opts.before, limit: 20 }),
  };
}

export { getCycle };
