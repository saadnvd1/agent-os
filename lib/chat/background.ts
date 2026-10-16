import type { ChatItem } from "./events";

type Tool = Extract<ChatItem, { kind: "tool" }>;
type Task = Extract<ChatItem, { kind: "task" }>;

// A call has to have run this long before it's offered: a quick command
// never flashes the button.
export const BACKGROUND_AFTER_MS = 3000;

// Whether a running call can be moved to the background now: the agent can
// do it, and the call is the one blocking its turn.
export function backgroundable(
  supported: boolean,
  tool: Pick<Tool, "status" | "createdAt">,
  task: Pick<Task, "status" | "backgrounded"> | undefined,
  now: number
): boolean {
  return (
    supported &&
    tool.status === "running" &&
    task?.status === "running" &&
    task.backgrounded === false &&
    now - tool.createdAt >= BACKGROUND_AFTER_MS
  );
}

// Errors that mean the agent never got the request.
const UNREACHED = new Set(["unsupported", "unavailable", "timeout"]);

// What to tell the reader when moving a call didn't happen; null when it did.
export function backgroundFailure(
  result: { ok: boolean; error?: string },
  tool: Pick<Tool, "status"> | undefined,
  task: Pick<Task, "backgrounded"> | undefined
): string | null {
  if (result.ok) return null;
  if (result.error) {
    return UNREACHED.has(result.error) || /went away/.test(result.error)
      ? "Couldn't reach the agent. Try again"
      : "Background tasks are turned off for this session";
  }
  if (tool && tool.status !== "running") return "That step already finished";
  if (task?.backgrounded) return "Already running in the background";
  return "Nothing to move to the background yet";
}

// The last line of a task's output that says anything.
export function outputTail(text: string | null | undefined): string | null {
  const lines = text?.split("\n") ?? [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return null;
}

// A running task that has printed nothing for this long is marked quiet.
export const QUIET_AFTER_MS = 5 * 60 * 1000;
const TAIL_LINES = 4;

// What the server reads of a task's output file: the end of it, and when it
// last changed.
export interface TaskOutput {
  text: string | null;
  updatedAt: number | null;
}

// The last few lines that say anything, oldest first.
export function outputLines(
  text: string | null | undefined,
  max = TAIL_LINES
): string[] {
  const lines = (text?.split("\n") ?? []).map((l) => l.trimEnd());
  return lines.filter((l) => l.trim()).slice(-max);
}

// "... failed with exit code 65" from the agent's note on a finished task.
export function exitCode(summary: string | undefined): number | null {
  const m =
    summary &&
    /exit(?:ed)?(?: with)?(?: status| code)?\s*:?\s*(-?\d+)/i.exec(summary);
  return m ? Number(m[1]) : null;
}

export type TaskLife =
  | { state: "active" }
  | { state: "quiet"; idleMs: number }
  | { state: "exited"; code: number | null; failed: boolean };

// Whether a task is progressing, has gone quiet, or has ended. Idle time
// counts from its last output, or from its start when it has printed nothing.
export function taskLife(
  task: Pick<Task, "status" | "createdAt" | "summary">,
  output: TaskOutput | null | undefined,
  now: number
): TaskLife {
  if (task.status !== "running") {
    const code = exitCode(task.summary);
    return {
      state: "exited",
      code: code ?? (task.status === "completed" ? 0 : null),
      failed: task.status === "failed" || (code !== null && code !== 0),
    };
  }
  const idleMs = Math.max(0, now - (output?.updatedAt ?? task.createdAt));
  return idleMs >= QUIET_AFTER_MS
    ? { state: "quiet", idleMs }
    : { state: "active" };
}
