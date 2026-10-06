// Fact builders for the orchestrator's event tests.

import type { TaskPR } from "../tasks/state";
import type { SessionFacts } from "./facts";

export const NOW = Date.parse("2026-10-06T12:00:00Z");

export const facts = (
  id: string,
  over: Partial<SessionFacts> = {}
): SessionFacts => ({
  id,
  name: "add-auth",
  project: "api",
  view: "terminal",
  status: "running",
  activity: null,
  needsInput: false,
  lastActive: NOW,
  branch: "feature/add-auth",
  task: { state: "working", pr: null, blocked: null },
  stack: null,
  ...over,
});

export const pr = (over: Partial<TaskPR> = {}): TaskPR => ({
  number: 12,
  url: "u",
  state: "OPEN",
  checks: "pending",
  head: "aaa",
  ...over,
});

export const withTask = (
  id: string,
  task: Partial<NonNullable<SessionFacts["task"]>>
) => facts(id, { task: { state: "review", pr: null, blocked: null, ...task } });
