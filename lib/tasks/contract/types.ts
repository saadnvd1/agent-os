import type { TaskView } from "../index";

/**
 * What this machine's task API does, for another machine deciding whether
 * it can trust it with a pinned merge or a move; keyed-start: a session
 * start takes a key, so it's safe to retry (lib/sessions/launch.ts).
 */
export const TASK_CAPABILITIES = [
  "pinned-merge",
  "move",
  "chat-turn",
  "keyed-start",
  "chat-move",
  // Holds an orchestrator's task for the machine that sent it, and answers
  // its messages, reads, stops and done (contract/authorize.ts).
  "orchestrated-move",
  // A held task's chat facts and its messages for its orchestrator.
  "held-chat-facts",
  "held-replies",
  // A keyed start that carries an orchestrator's description holds the task
  // for the device that sent it, as a move does (lib/tasks/held.ts).
  "held-start",
  // A plan placed here by another machine stops at the plan for that machine
  // to decide what follows (contract/plan.ts).
  "remote-plan",
  // Every task route a peer calls checks the holder or starter the same way.
  // compat: the shims marked "task-contract-1" in contract/ go once every
  // linked machine reports this.
  "task-contract-1",
] as const;

export interface HostTasks {
  tasks: TaskView[];
  moved?: { id: string; movedTo: string | null }[];
  capabilities?: string[];
}

export interface ChatFacts {
  blocked: string | null;
  turn: string | null;
}
