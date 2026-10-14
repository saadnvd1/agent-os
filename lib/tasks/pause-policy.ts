/**
 * The rules of a timed pause, as pure functions: what can't be paused, who
 * may undo whose pause, and the one prompt a session gets when it resumes.
 */

import type { PauseBy } from "./schedule-types";

export interface PauseFacts {
  // A task (it holds a slot) as opposed to a plain chat or terminal session.
  isTask: boolean;
  isOrchestrator: boolean;
  isQuickChange: boolean;
  // Runs on, or is a mirror of, a linked machine.
  isRemote: boolean;
  taskStatus: string | null;
  pauseState: string | null;
  // Moving, or its stack is landing.
  held: boolean;
  // Between `gh pr merge` and the database knowing it, or tidying after.
  merging: boolean;
  settingUp: boolean;
  // Waiting on a person.
  chatWaiting: boolean;
  terminalWaiting: boolean;
  openAsk: boolean;
  openQuestion: boolean;
  escalated: boolean;
  planAwaiting: boolean;
  // A terminal whose agent can be started again from its saved conversation
  // (Claude with a conversation id). A chat always can.
  resumable: boolean;
}

// Why it can't be paused now, or null.
export function pauseRefusal(f: PauseFacts): string | null {
  if (f.isOrchestrator)
    return "An orchestrator is paused with its workspace's Pause, not on its own";
  if (f.isQuickChange)
    return "A quick change runs no agent, so there is nothing to pause";
  if (f.isRemote) return "It runs on another machine: pause it from there";
  if (!f.resumable)
    return "Its agent can't be started again from where it stopped, so it can't be paused";
  if (f.isTask && f.taskStatus && f.taskStatus !== "running")
    return `It's ${f.taskStatus}, not running`;
  if (f.pauseState === "paused") return "It's already paused";
  if (f.merging) return "It's merging";
  if (f.held) return "It's moving to another machine or its stack is landing";
  if (f.settingUp) return "It's still setting up; pause it once it has started";
  if (
    f.chatWaiting ||
    f.terminalWaiting ||
    f.openAsk ||
    f.openQuestion ||
    f.escalated ||
    f.planAwaiting
  )
    return "It's waiting on you";
  return null;
}

const RANK: Record<PauseBy, number> = {
  scheduler: 1,
  orchestrator: 2,
  person: 3,
};

// A pause is lifted by its own kind or a higher one: a person above the
// orchestrator above the scheduler.
export function mayResume(actor: PauseBy, pausedBy: PauseBy): boolean {
  return RANK[actor] >= RANK[pausedBy];
}

export function resumeRefusal(
  actor: PauseBy,
  pausedBy: PauseBy,
  untilLabel: string | null
): string | null {
  if (mayResume(actor, pausedBy)) return null;
  const who = pausedBy === "person" ? "a person" : "the orchestrator";
  return `Paused by ${who}${untilLabel ? ` until ${untilLabel}` : ""}; only ${pausedBy === "person" ? "they" : "the orchestrator or a person"} can resume it`;
}

export interface HeldMessage {
  from: string;
  text: string;
}

const BY_TEXT: Record<PauseBy, string> = {
  person: "by the user",
  orchestrator: "by the orchestrator",
  scheduler: "by the scheduler because the machine was loaded",
};

export function durationText(fromMs: number, untilMs: number | null): string {
  if (untilMs === null) return "until resumed";
  const minutes = Math.max(1, Math.round((untilMs - fromMs) / 60_000));
  if (minutes < 90) return `for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `for ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `for ${days} days`;
}

// The prompt a resumed session gets, with everything held while it was
// paused folded in.
export function continuePrompt(input: {
  pausedAt: string;
  by: PauseBy;
  duration: string;
  interrupted: boolean;
  held: HeldMessage[];
}): string {
  const lines = [
    `You were paused at ${input.pausedAt} (${BY_TEXT[input.by]}, ${input.duration}) and are resumed now.${
      input.interrupted
        ? " Your last step was interrupted; check whether it finished before redoing it."
        : ""
    }`,
  ];
  if (input.held.length) {
    lines.push(
      `While you were paused, ${input.held.length} message${input.held.length === 1 ? "" : "s"} arrived:`,
      ...input.held.map((m, i) => `${i + 1}. From ${m.from}: ${m.text}`)
    );
  }
  lines.push(
    "Check the worktree, the branch against its PR and CI before you continue, then carry on with the task."
  );
  return lines.join("\n");
}
