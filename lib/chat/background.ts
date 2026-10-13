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

// Ctrl+B, nothing else held, and only while there is something to move;
// otherwise the key is left to the page.
export function backgroundKey(
  e: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    repeat?: boolean;
    isComposing?: boolean;
  },
  available: boolean
): boolean {
  return (
    available &&
    e.key.toLowerCase() === "b" &&
    e.ctrlKey &&
    !(e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing)
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
