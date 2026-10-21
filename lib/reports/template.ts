// The report with no model: sentences built from the same evidence. Used when
// the model fails or every line it wrote was rejected, and for the headline.

import type { TaskState } from "../tasks/state";
import type { EvidenceRef, ReportLine } from "./types";

const HEADLINES: Record<TaskState, string> = {
  working: "The agent is working on it",
  "needs-input": "The agent is waiting for an answer",
  blocked: "The task is blocked and needs a decision",
  review: "The pull request is open and waiting on review",
  "checks-failing": "Checks are failing on the latest push",
  "plan-ready": "The plan is written and waits for your approval",
  exited: "The agent stopped before finishing",
  merged: "The work is merged",
  dropped: "The task was dropped",
  done: "The task is finished",
  moving: "The task is moving to another machine",
};

export const headlineFor = (state: TaskState) => HEADLINES[state];

const NEXT: Partial<Record<TaskState, string>> = {
  "checks-failing": "Next: fix the failing checks, then push again.",
  review: "Next: wait for the review and the checks to settle, then merge.",
  blocked: "Next: answer what the task is waiting on.",
  "needs-input": "Next: reply to the agent so it can go on.",
  "plan-ready": "Next: read the plan and approve it.",
  exited: "Next: restart the agent or take the work over.",
  working: "Next: let the agent finish its turn.",
};

export function templateLines(
  state: TaskState,
  evidence: EvidenceRef[]
): {
  lines: ReportLine[];
  recommendation: { text: string; evidence: string[] } | null;
} {
  const lines: ReportLine[] = [];
  const add = (tone: ReportLine["tone"], text: string, ev: EvidenceRef[]) =>
    lines.push({
      id: `l${lines.length + 1}`,
      tone,
      text,
      evidence: ev.map((e) => e.id),
    });
  const of = (kind: EvidenceRef["kind"]) =>
    evidence.filter((e) => e.kind === kind);

  const ci = of("ci");
  const ciPass = ci.filter((e) => e.status === "pass");
  const ciFail = ci.filter((e) => e.status === "fail");
  const ciWait = ci.filter((e) => e.status === "pending");
  if (ciPass.length)
    add(
      "done",
      `${ciPass.length} CI check${ciPass.length === 1 ? "" : "s"} passed.`,
      ciPass
    );
  for (const e of ciFail) add("warn", `${e.label} is failing.`, [e]);
  if (ciWait.length)
    add(
      "warn",
      `${ciWait.length} CI check${ciWait.length === 1 ? " is" : "s are"} still running.`,
      ciWait
    );

  for (const e of of("test"))
    add(
      e.status === "pass" ? "done" : e.status === "fail" ? "warn" : "next",
      e.status === "pass"
        ? `Tests passed: ${e.label}.`
        : e.status === "fail"
          ? `Tests failed: ${e.label}.`
          : `Tests are running: ${e.label}.`,
      [e]
    );

  for (const e of of("review"))
    add(
      e.status === "pass" ? "done" : e.status === "fail" ? "warn" : "next",
      e.status === "pass"
        ? "The independent review passed."
        : e.status === "fail"
          ? "The independent review found problems to fix."
          : "The independent review has not finished.",
      [e]
    );

  for (const e of of("piece"))
    add(e.status === "pass" ? "done" : "next", `${e.label}.`, [e]);
  for (const e of of("accept").filter((e) => e.status === "pass"))
    add("done", `Verified: ${e.label}.`, [e]);
  for (const e of of("ask")) add("blocked", `${e.label}.`, [e]);
  for (const e of of("log")) add("done", `${e.label}.`, [e]);

  const hasDiff = of("diff");
  if (hasDiff.length)
    add(
      "done",
      `${hasDiff.length} file${hasDiff.length === 1 ? "" : "s"} changed.`,
      hasDiff.slice(0, 12)
    );

  const stateEv = of("state");
  if (NEXT[state] && stateEv.length) add("next", NEXT[state]!, stateEv);

  const bad = [...ciFail, ...of("test").filter((e) => e.status === "fail")];
  const recommendation = bad.length
    ? {
        text: `Ask the agent to fix ${bad[0].label} first; everything else waits on it.`,
        evidence: [bad[0].id],
      }
    : null;
  return { lines, recommendation };
}
