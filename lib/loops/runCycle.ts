import type { Session } from "../db";
import type { SessionFacts } from "../orchestrator/facts";
import { checkCriteria } from "./checkCriteria";
import { evidenceText, scoreOf } from "./compactEvidence";
import { decideStop, type Stop } from "./decideStop";
import type { LoopDeps } from "./deps";
import { callHook } from "./hooks";
import { instructionText, mirrorToPairing } from "./sendInstruction";
import { screenInstruction } from "./screenInstruction";
import {
  claimCycle,
  criteriaOf,
  cycleCount,
  cyclesOf,
  getCycle,
  getLoop,
  markCriterion,
  moveCycle,
  patchCycle,
  touchLoop,
} from "./store";
import { finishLoop } from "./stopLoop";
import type { CycleRow, CycleTrigger, EvidenceSummary, LoopRow } from "./types";

// A turn that ends with nothing changed: nudge, don't spend a model run.
export const NO_CHANGE_NUDGE =
  "Your last turn changed nothing in the worktree. Take the first open acceptance criterion and make a concrete change for it, then run the checks. If something is stopping you, say so on a line starting with BLOCKED:.";

const inflight = new Set<string>();
export const cycleInFlight = (loopId: string) => inflight.has(loopId);

const BLOCKED_LINE = /^\s*BLOCKED:\s*(.+)$/m;
const RETRY_AFTER_ERROR_MS = 60_000;
const SEND_RETRY_MS = 15_000;

interface Ctx {
  loop: LoopRow;
  task: Session;
  facts: SessionFacts | undefined;
  deps: LoopDeps;
}

const nameOf = (task: Session) => task.name;

function stop(ctx: Ctx, s: Stop): void {
  finishLoop(ctx.loop, s, { taskName: nameOf(ctx.task), now: ctx.deps.now() });
}

// Opens a cycle and runs it to the point where an instruction waits to be
// sent (or the loop stopped). One at a time per loop.
export async function startCycle(
  loopId: string,
  trigger: CycleTrigger,
  facts: SessionFacts | undefined,
  deps: LoopDeps
): Promise<void> {
  if (inflight.has(loopId)) return;
  const loop = getLoop(loopId);
  const task = loop && deps.task(loop.sessionId);
  if (!loop || loop.state !== "running" || !task) return;
  const cycle = claimCycle(loop.id, trigger, deps.now());
  if (!cycle) return;
  await processCycle({ loop, task, facts, deps }, cycle);
}

// Runs a claimed cycle; after a restart it picks the same row up again.
export async function processCycle(ctx: Ctx, cycle: CycleRow): Promise<void> {
  if (inflight.has(ctx.loop.id)) return;
  inflight.add(ctx.loop.id);
  try {
    await analyseCycle(ctx, cycle);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    patchCycle(ctx.loop.id, cycle.n, {
      state: "error",
      error: why.slice(0, 500),
      endedAt: ctx.deps.now(),
    });
    const recent = cyclesOf(ctx.loop.id, { limit: 2 });
    if (recent.length === 2 && recent.every((c) => c.state === "error"))
      stop(ctx, {
        reason: "blocked",
        detail: `The cycle failed twice: ${why.slice(0, 200)}`,
      });
  } finally {
    inflight.delete(ctx.loop.id);
  }
}

async function analyseCycle(ctx: Ctx, cycle: CycleRow): Promise<void> {
  const { loop, task, deps } = ctx;
  const previous = cyclesOf(loop.id, { limit: 10 }).filter(
    (c) => c.n < cycle.n
  );
  const lastSnap = previous.find((c) => c.snapshotSha);
  const prepared = await deps.prepare(task);
  const snap = await deps.snapshot(prepared.dir);
  const changed = !lastSnap?.tree || lastSnap.tree !== snap.tree;
  const reply = deps.coderReply(task);

  let evidence: EvidenceSummary;
  let signature: string | null;
  let analysis: CycleRow["analysis"] = null;
  let costUsd = 0;
  let marksMet: number;

  if (!changed && lastSnap?.evidence) {
    // Nothing to inspect that the last cycle didn't: its evidence stands.
    evidence = lastSnap.evidence;
    signature = lastSnap.signature;
    marksMet = criteriaOf(loop.id).filter(
      (c) => c.status === "met" || c.status === "waived"
    ).length;
    patchCycle(loop.id, cycle.n, {
      snapshotSha: snap.sha,
      tree: snap.tree,
      changed: false,
      evidence,
      signature,
    });
  } else {
    const commands = await deps.commands(prepared.repo, prepared.base);
    const testFiles = await deps.testFiles(
      prepared.dir,
      prepared.base,
      snap.sha
    );
    const gathered = await deps.gather({
      taskId: task.id,
      n: cycle.n,
      dir: prepared.dir,
      commands,
      testFiles,
    });
    const pr = ctx.facts?.task?.pr;
    const ci = pr
      ? [
          {
            name: pr.failing ?? "checks",
            state: pr.checks === "pass" ? "success" : String(pr.checks),
            sha: pr.head ?? null,
          },
        ]
      : [];
    evidence = { ...gathered.summary, ci };
    signature = gathered.signature;
    patchCycle(loop.id, cycle.n, {
      snapshotSha: snap.sha,
      tree: snap.tree,
      changed: true,
      evidence,
      logPath: gathered.logPath,
      signature,
    });
    const diff = await deps.diff(
      prepared.dir,
      prepared.base,
      snap.sha,
      lastSnap?.snapshotSha ?? null
    );
    const wake =
      pr && pr.checks === "fail" && pr.failing
        ? `CI check "${pr.failing}" is failing on the PR's head.`
        : null;
    const result = await deps.analyse({
      repo: prepared.repo,
      sha: snap.sha,
      workspaceId: loop.workspaceId,
      prompt: {
        goal: task.task_prompt || loop.goal,
        amendments: deps.amendments(task.id),
        criteria: criteriaOf(loop.id),
        evidence: evidenceText(evidence.commands, ci),
        diffMap: diff.map,
        recent: previous.slice(0, 2).reverse(),
        coderReply: reply,
        wake,
      },
    });
    analysis = result.analysis;
    costUsd = result.costUsd;
    const marks = checkCriteria(criteriaOf(loop.id), analysis, {
      green: evidence.green,
      commands: evidence.commands,
      hunks: diff.hunks,
      ci,
      snapshotSha: snap.sha,
    });
    for (const m of marks)
      markCriterion(m.id, m.status, m.evidence, m.verified, cycle.n);
    marksMet = marks.filter(
      (m) => m.status === "met" || m.status === "waived"
    ).length;
  }

  const score = scoreOf(evidence.commands, marksMet);
  patchCycle(loop.id, cycle.n, {
    analysis,
    score,
    costUsd,
    input: reply ? reply.slice(0, 2000) : null,
  });
  callHook("onCycleSettled", {
    taskId: task.id,
    cycleId: cycle.id,
    analystSummary: analysis?.summary ?? null,
  });

  // The user typed to the coder meanwhile: their message wins.
  if (await deps.coderRunning(task)) {
    moveCycle(loop.id, cycle.n, ["claimed"], {
      state: "superseded",
      endedAt: deps.now(),
    });
    return;
  }

  const criteria = criteriaOf(loop.id);
  const finished = cyclesOf(loop.id, { limit: 40 })
    .filter((c) => c.score)
    .reverse();
  const blocked =
    analysis?.blocker?.text ??
    BLOCKED_LINE.exec(reply ?? "")?.[1]?.trim() ??
    (ctx.facts?.needsInput
      ? "the coding agent is waiting for an answer"
      : null) ??
    deps.waitingOnPerson(task);
  const fresh = getLoop(loop.id)!;
  const draft = changed
    ? (analysis?.next?.instruction ?? null)
    : NO_CHANGE_NUDGE;
  const decided = decideStop({
    limits: fresh,
    startedAt: fresh.startedAt,
    cycles: finished,
    cycleCount: cycleCount(loop.id),
    criteria,
    green: evidence.green,
    spentUsd: deps.spent(fresh),
    now: deps.now(),
    blocked,
  });
  if (decided) {
    patchCycle(loop.id, cycle.n, {
      instruction: decided.reason === "done" ? null : draft,
    });
    stop(ctx, decided);
    return;
  }
  if (!draft) {
    patchCycle(loop.id, cycle.n, {});
    stop(ctx, {
      reason: "blocked",
      detail: "The analyst has no next step, but criteria are still open",
    });
    return;
  }
  const refused = screenInstruction(draft);
  if (refused) {
    patchCycle(loop.id, cycle.n, { instruction: draft });
    stop(ctx, {
      reason: "blocked",
      detail: `The next instruction was held back: ${refused.why}`,
      askKind: refused.kind,
    });
    return;
  }
  const grace = fresh.graceSeconds;
  patchCycle(loop.id, cycle.n, {
    instruction: draft,
    sender: "analyst",
    sendAt: deps.now() + grace * 1000,
  });
  moveCycle(loop.id, cycle.n, ["claimed"], { state: "counting" });
  touchLoop(loop.id, deps.now());
  if (grace === 0) await deliverCycle({ ...ctx, loop: fresh }, cycle.n);
}

// Sends a cycle's instruction once (the state move claims it). A failed
// send goes back to counting; a second failure stops the loop.
export async function deliverCycle(ctx: Ctx, n: number): Promise<boolean> {
  const { loop, task, deps } = ctx;
  const before = getCycle(loop.id, n);
  if (!before || !before.instruction) return false;
  if (!moveCycle(loop.id, n, ["counting", "decided"], { state: "sending" }))
    return false;
  const open = criteriaOf(loop.id).filter(
    (c) => c.status !== "met" && c.status !== "waived"
  );
  const text =
    before.instructionSent ?? instructionText(before.instruction, open);
  try {
    const delivery = await deps.send(task, loop.id, n, text);
    patchCycle(loop.id, n, {
      state: "sent",
      delivery,
      instructionSent: text,
      sender: before.sender ?? "analyst",
      error: null,
      endedAt: deps.now(),
    });
    touchLoop(loop.id, deps.now());
    mirrorToPairing(task.id, loop.id, n, text, before.analysis);
    return true;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    patchCycle(loop.id, n, {
      state: "counting",
      sendAt: deps.now() + SEND_RETRY_MS,
      error: why.slice(0, 300),
    });
    if (before.error) {
      stop(ctx, {
        reason: "blocked",
        detail: `The instruction couldn't be delivered: ${why.slice(0, 200)}`,
      });
    }
    return false;
  }
}

export const RETRY_MS = RETRY_AFTER_ERROR_MS;
