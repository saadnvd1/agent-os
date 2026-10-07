import { randomUUID } from "crypto";
import type { ChatItem, DriverEvent, FileDiff, ToolStatus } from "../events";
import { clipOutput } from "../tools";

type Tool = Extract<ChatItem, { kind: "tool" }>;
type Text = Extract<ChatItem, { kind: "assistant" | "reasoning" }>;
type Todo = Extract<ChatItem, { kind: "todos" }>["todos"][number];

export interface ToolStart {
  name: string;
  title: string;
  input: unknown;
  diff?: FileDiff;
}

// An API's error as its message: providers wrap JSON in JSON.
export function readableError(text: string): string {
  let message = text.trim();
  for (let i = 0; i < 4; i++) {
    try {
      const parsed = JSON.parse(message) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      const inner =
        typeof parsed.error === "object"
          ? parsed.error?.message
          : (parsed.error ?? parsed.message);
      if (typeof inner !== "string") break;
      message = inner.trim();
    } catch {
      break;
    }
  }
  return message.length > 500 ? `${message.slice(0, 499)}…` : message;
}

// The provider-neutral items of one conversation, built up as an agent's
// own events arrive: streamed text, tool calls and the end of each turn.
// Every driver but Claude's maps its protocol onto these calls.
export class TurnItems {
  private texts = new Map<string, Text>();
  private tools = new Map<string, Tool>();
  private startedAt = 0;
  inTurn = false;

  constructor(private emit: (e: DriverEvent) => void) {}

  startTurn(): void {
    if (this.inTurn) return;
    this.inTurn = true;
    this.startedAt = Date.now();
    this.emit({ type: "turn_start" });
  }

  // Appends streamed text to the item for `key`, created on its first text
  // so a block that never says anything never shows as an empty bubble.
  delta(key: string, kind: Text["kind"], text: string): void {
    if (!text) return;
    const current = this.texts.get(key);
    if (current) {
      current.text += text;
      this.emit({ type: "delta", id: current.id, text });
      return;
    }
    const item: Text = {
      id: randomUUID(),
      kind,
      text,
      streaming: true,
      createdAt: Date.now(),
    };
    this.texts.set(key, { ...item });
    this.emit({ type: "item", item });
  }

  // The finished text for `key`: what streamed, unless the agent says
  // otherwise.
  finishText(key: string, kind: Text["kind"], full?: string): void {
    const current = this.texts.get(key);
    this.texts.delete(key);
    const text = full ?? current?.text ?? "";
    if (!text.trim()) return;
    this.emit({
      type: "item",
      item: {
        id: current?.id ?? randomUUID(),
        kind,
        text,
        createdAt: current?.createdAt ?? Date.now(),
      },
    });
  }

  tool(id: string, start: ToolStart): void {
    const prev = this.tools.get(id);
    const item: Tool = {
      id,
      kind: "tool",
      ...start,
      status: "running",
      createdAt: prev?.createdAt ?? Date.now(),
    };
    this.tools.set(id, item);
    this.emit({ type: "item", item });
  }

  hasText(key: string): boolean {
    return this.texts.has(key);
  }

  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  toolDone(
    id: string,
    status: Exclude<ToolStatus, "running">,
    output?: string,
    update?: Partial<ToolStart>
  ): void {
    const tool = this.tools.get(id);
    if (!tool) return;
    this.tools.delete(id);
    this.emit({
      type: "item",
      item: {
        ...tool,
        ...update,
        status,
        output:
          status === "stopped" || output === undefined
            ? undefined
            : clipOutput(output),
        endedAt: Date.now(),
      },
    });
  }

  todos(todos: Todo[]): void {
    this.emit({
      type: "item",
      item: { id: "todos", kind: "todos", todos, createdAt: Date.now() },
    });
  }

  error(message: string): void {
    this.emit({
      type: "item",
      item: {
        id: randomUUID(),
        kind: "error",
        message: readableError(message),
        createdAt: Date.now(),
      },
    });
  }

  // Closes the turn: text still streaming settles, tools still running
  // were cut off.
  endTurn(end: { interrupted?: boolean; error?: string; costUsd?: number }) {
    if (!this.inTurn) return;
    this.inTurn = false;
    for (const [key, text] of [...this.texts]) this.finishText(key, text.kind);
    for (const id of [...this.tools.keys()]) this.toolDone(id, "stopped");
    if (end.error && !end.interrupted) this.error(end.error);
    this.emit({
      type: "item",
      item: {
        id: randomUUID(),
        kind: "turn_end",
        durationMs: Date.now() - this.startedAt,
        costUsd: end.costUsd,
        interrupted: end.interrupted,
        createdAt: Date.now(),
      },
    });
    this.emit({ type: "state", state: "idle" });
  }
}
