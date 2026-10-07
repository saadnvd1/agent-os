/**
 * A new session's setup as it happens (fetch, worktree, env files, deps,
 * setup script), for the card its chat shows until the agent starts. Kept
 * in memory: the outcome is recorded on the session row, and a restart
 * mid-setup is recorded there as a failure.
 */

import type { SetupStage, SetupStep } from "../env-setup";

export type StageId = "fetch" | "worktree" | SetupStage;
export type StageState = "pending" | "running" | "ok" | "failed" | "skipped";

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
}

export interface SetupView {
  status: "running" | "ok" | "failed";
  stages: Stage[];
  // The last lines of what the steps printed.
  log: string[];
  branch: string | null;
  error: string | null;
  startedAt: number;
}

const LABELS: Record<StageId, string> = {
  fetch: "Fetch",
  worktree: "Create worktree",
  env: "Copy env files",
  deps: "Install dependencies",
  script: "Run setup script",
};
const ORDER: StageId[] = ["fetch", "worktree", "env", "deps", "script"];
const LOG_LINES = 40;
const KEEP_FINISHED_MS = 10 * 60 * 1000;

const g = globalThis as { __agentosSetups?: Map<string, SetupView> };
const setups = (g.__agentosSetups ??= new Map());

export function startSetup(sessionId: string, branch: string): SetupView {
  const view: SetupView = {
    status: "running",
    stages: ORDER.map((id) => ({ id, label: LABELS[id], state: "pending" })),
    log: [],
    branch,
    error: null,
    startedAt: Date.now(),
  };
  setups.set(sessionId, view);
  return view;
}

export function getSetup(sessionId: string): SetupView | null {
  return setups.get(sessionId) ?? null;
}

export function settingUp(sessionId: string): boolean {
  return setups.get(sessionId)?.status === "running";
}

// Starting a stage finishes the one before it.
export function enterStage(view: SetupView, id: StageId): void {
  for (const s of view.stages) {
    if (s.id === id) s.state = "running";
    else if (s.state === "running") s.state = "ok";
  }
}

export function logStep(view: SetupView, step: SetupStep): void {
  const text = [
    `$ ${step.command}`,
    ...(step.output ?? "").split("\n"),
    ...(step.success ? [] : (step.error ?? "").split("\n")),
  ];
  view.log.push(...text.map((l) => l.trimEnd()).filter(Boolean));
  view.log.splice(0, Math.max(0, view.log.length - LOG_LINES));
  if (!step.success) {
    const running = view.stages.find((s) => s.state === "running");
    if (running) running.state = "failed";
  }
}

export function finishSetup(
  sessionId: string,
  view: SetupView,
  error: string | null
): void {
  for (const s of view.stages) {
    if (s.state === "running") s.state = error ? "failed" : "ok";
    else if (s.state === "pending") s.state = "skipped";
  }
  view.status = error ? "failed" : "ok";
  view.error = error;
  setTimeout(() => {
    if (setups.get(sessionId) === view) setups.delete(sessionId);
  }, KEEP_FINISHED_MS).unref?.();
}
