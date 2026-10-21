// A stubbed world for the loop: a coder that ends turns and changes files, an
// analyst that answers from a script, and a checks run that reports what the
// scenario says, on a clock the test moves. No model, shell or chat.
import { db, updateSessionRow } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { createWorkspace, setProjectWorkspace } from "@/lib/workspaces";
import { ensureOrchestrator } from "@/lib/orchestrator/home";
import { seedSession } from "@/lib/orchestrator/testing";
import type { SessionFacts } from "@/lib/orchestrator/facts";
import type { LoopDeps } from "./deps";
import { resetLoopMemory, tickLoops } from "./tickLoops";
import { startLoop } from "./controls";
import { latestLoopFor } from "./store";
import type { Analysis, CommandResult, Limits } from "./types";

export interface Scenario {
  // The failing tests (and so the signature) of cycle n; [] is green.
  failing: (n: number) => string[];
  // How many criteria the analyst marks met in cycle n (citing the diff).
  met: (n: number) => number;
  // Spend by the end of cycle n, in dollars.
  spent?: (n: number) => number;
  // The coder changed nothing in this cycle's turn.
  unchanged?: (n: number) => boolean;
  // Words the analyst gives as the next instruction.
  instruction?: (n: number) => string | null;
  blocker?: (n: number) => Analysis["blocker"];
}

export const CRITERIA = Array.from({ length: 10 }, (_, i) => ({
  text: `Criterion ${i + 1}`,
}));

export async function makeWorld(
  scenario: Scenario,
  limits: Partial<Limits> = {}
) {
  const ws = createWorkspace(
    `loop-ws-${Math.random().toString(36).slice(2, 8)}`
  );
  const project = createProject({
    name: `loop-app-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: "/tmp/loop-app",
  });
  setProjectWorkspace(project.id, ws.id);
  ensureOrchestrator(ws.id);
  const taskId = seedSession({
    projectId: project.id,
    name: "loop-task",
    task: true,
    view: "chat",
    branch: "feature/x",
  });
  updateSessionRow(db, taskId, {
    base_branch: "main",
    task_prompt: "Build the thing",
    worktree_path: "/tmp/loop-app",
    workspace_id: ws.id,
  });

  const world = {
    ws: ws.id,
    taskId,
    t: Date.parse("2026-10-21T12:00:00Z"),
    rev: 1,
    cycle: 0,
    spent: 0,
    sent: [] as string[],
    running: false,
    prompts: [] as string[],
    fact: {
      id: taskId,
      name: "loop-task",
      project: project.id,
      view: "chat",
      status: "idle",
      activity: null,
      needsInput: false,
      lastActive: 0,
      branch: "feature/x",
      task: { state: "working", pr: null, blocked: null },
      stack: null,
    } as unknown as SessionFacts,
  };
  world.fact.lastActive = world.t - 10 * 60_000;

  const deps: LoopDeps = {
    now: () => world.t,
    task: (id) =>
      id === taskId
        ? (db
            .prepare(`SELECT * FROM session_rows WHERE id = ?`)
            .get(id) as never)
        : undefined,
    prepare: async () => ({
      repo: "/tmp/loop-app",
      base: "origin/main",
      dir: "/tmp/loop-app",
    }),
    snapshot: async () => ({
      sha: `sha${world.rev}`,
      tree: `tree${world.rev}`,
    }),
    commands: async () => ({ typecheck: null, test: "npm test" }),
    testFiles: async () => [],
    gather: async () => {
      const n = world.cycle;
      const failing = scenario.failing(n);
      const test: CommandResult = {
        name: "test",
        command: "npm test",
        exitCode: failing.length ? 1 : 0,
        durationMs: 1000,
        passed: failing.length ? [] : ["all.test.ts"],
        failed: failing,
        errors: [],
        excerpt: failing.length ? failing.join("\n") : "",
      };
      return {
        summary: { green: !failing.length, commands: [test], ci: [] },
        signature: failing.length ? `test: ${failing.join("; ")}` : null,
        logPath: null,
      };
    },
    diff: async () => ({
      map: "diff",
      hunks: new Map([["a.ts", [[1, 100] as [number, number]]]]),
    }),
    analyse: async (input) => {
      const n = world.cycle;
      world.prompts.push(input.prompt.goal);
      world.spent = scenario.spent?.(n) ?? world.spent;
      const met = scenario.met(n);
      const criteria = input.prompt.criteria;
      return {
        costUsd: 0,
        analysis: {
          summary: `Cycle ${n} summary`,
          findings: [],
          criteria: criteria.map((c, i) => ({
            id: c.id,
            status: i < met ? ("met" as const) : ("open" as const),
            ...(i < met
              ? {
                  evidence: {
                    kind: "diff" as const,
                    ref: "a.ts:5",
                    note: "changed",
                  },
                }
              : {}),
          })),
          next:
            scenario.instruction?.(n) === null
              ? null
              : {
                  instruction:
                    scenario.instruction?.(n) ??
                    `Fix the failures from cycle ${n}`,
                  focus: [],
                },
          blocker: scenario.blocker?.(n) ?? null,
        },
      };
    },
    send: async (_task, _loopId, _n, text) => {
      world.sent.push(text);
      world.running = true;
      return "sent";
    },
    coderReply: () => null,
    coderRunning: async () => false,
    amendments: () => [],
    spent: () => world.spent,
    hold: () => null,
    waitingOnPerson: () => null,
  };
  // The cycle number gather and analyse see is the one being claimed.
  const real = deps.snapshot;
  deps.snapshot = async (dir) => {
    world.cycle = latestCycleN() ?? 0;
    return real(dir);
  };
  const latestCycleN = () => {
    const loop = latestLoopFor(taskId);
    return loop
      ? (
          db
            .prepare(
              `SELECT MAX(n) AS n FROM task_loop_cycles WHERE loop_id = ?`
            )
            .get(loop.id) as { n: number | null }
        ).n
      : null;
  };

  resetLoopMemory();
  await startLoop(
    taskId,
    { criteria: CRITERIA, limits: { graceSeconds: 0, ...limits } },
    deps
  );

  const tick = () => tickLoops(world.ws, [world.fact], deps);
  const state = () => latestLoopFor(taskId)!;
  // The coder takes a turn (runs, then goes quiet), then the loop looks.
  async function round() {
    world.fact.status = "running";
    await tick();
    world.t += 60_000;
    world.fact.status = "idle";
    world.fact.lastActive = world.t - 30_000;
    if (!scenario.unchanged?.(world.cycle)) world.rev++;
    await tick();
  }
  async function run(maxRounds = 40) {
    await tick();
    for (let i = 0; i < maxRounds && state().state === "running"; i++)
      await round();
    return state();
  }
  return { world, deps, tick, round, run, state };
}
