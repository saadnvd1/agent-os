import type { ChatContext, DriverEvent, UsageTotals } from "../events";
import { toolTitle } from "../tools";
import { TurnItems, type ToolStart } from "./turn-items";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

const TODO_STATUS = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
} as const;

// "*** Update File: f.txt" in an apply_patch the agent made.
const patchFile = (patch: string) =>
  patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1]?.trim();

export function toolStart(update: P): ToolStart {
  const raw = update.rawInput;
  const input = (typeof raw === "object" && raw ? raw : {}) as P;
  const file =
    str(input.path) ||
    str(input.fileName) ||
    str((update.locations as P[] | undefined)?.[0]?.path) ||
    (typeof raw === "string" ? patchFile(raw) : undefined) ||
    "";
  const title = str(update.title);
  switch (str(update.kind)) {
    case "execute": {
      const command = str(input.command);
      return {
        name: "Bash",
        title: toolTitle("Bash", { command, description: input.description }),
        input: { command, description: input.description },
      };
    }
    case "edit":
    case "delete":
    case "move":
      return {
        name: "Edit",
        title: file ? toolTitle("Edit", { file_path: file }) : title,
        input: { file_path: file },
      };
    case "read":
      if (input.pattern)
        return {
          name: "Glob",
          title: toolTitle("Glob", { pattern: input.pattern }),
          input,
        };
      return {
        name: "Read",
        title: toolTitle("Read", { file_path: file }),
        input: { file_path: file },
      };
    case "search":
      return {
        name: "Grep",
        title: toolTitle("Grep", { pattern: input.pattern ?? input.query }),
        input,
      };
    case "fetch":
      return {
        name: "WebFetch",
        title: toolTitle("WebFetch", { url: input.url }),
        input,
      };
    default:
      return { name: title || "Tool", title: title || "Tool", input: raw };
  }
}

function contentText(update: P): string {
  const parts = (update.content as P[] | undefined) ?? [];
  const text = parts
    .map((c) => (c.type === "content" ? str((c.content as P)?.text) : ""))
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  const raw = (update.rawOutput ?? {}) as P;
  return str(raw.content);
}

// Copilot's session updates as chat items. One per conversation.
export class CopilotMapper {
  readonly items: TurnItems;
  readonly totals: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  // Text before and after a tool call are separate bubbles.
  private block = 0;
  // A resumed conversation replays its history before it's ready: not ours.
  replaying = false;

  constructor(private emit: (e: DriverEvent) => void) {
    this.items = new TurnItems(emit);
  }

  map(update: P): void {
    if (this.replaying) return;
    const text = str((update.content as P | undefined)?.text);
    switch (str(update.sessionUpdate)) {
      case "agent_message_chunk":
        this.items.startTurn();
        return this.items.delta(`m${this.block}`, "assistant", text);
      case "agent_thought_chunk":
        this.items.startTurn();
        return this.items.delta(`r${this.block}`, "reasoning", text);
      case "tool_call":
        return this.started(update);
      case "tool_call_update":
        return this.updated(update);
      case "plan":
        return this.items.todos(
          ((update.entries as P[]) ?? []).map((e) => ({
            text: str(e.content),
            status:
              TODO_STATUS[str(e.status) as keyof typeof TODO_STATUS] ??
              "pending",
          }))
        );
      case "usage_update":
        return this.context(update);
    }
  }

  private close(): void {
    this.items.finishText(`m${this.block}`, "assistant");
    this.items.finishText(`r${this.block}`, "reasoning");
    this.block++;
  }

  private started(update: P): void {
    this.items.startTurn();
    this.close();
    this.items.tool(str(update.toolCallId), toolStart(update));
  }

  private updated(update: P): void {
    const id = str(update.toolCallId);
    const status = str(update.status);
    if (status !== "completed" && status !== "failed") return;
    const start = toolStart(update);
    if (!this.items.hasTool(id)) this.items.tool(id, start);
    const diff = ((update.content as P[]) ?? []).find((c) => c.type === "diff");
    const changed = diff
      ? {
          path: str(diff.path),
          before: str(diff.oldText),
          after: str(diff.newText),
        }
      : undefined;
    this.items.toolDone(
      id,
      status === "failed" ? "error" : "done",
      contentText(update),
      changed
        ? {
            name: "Edit",
            title: toolTitle("Edit", { file_path: changed.path }),
            diff: changed,
          }
        : undefined
    );
  }

  private context(update: P): void {
    const used = Number(update.used);
    const max = Number(update.size);
    if (!max || !Number.isFinite(used)) return;
    const context: ChatContext = {
      usedTokens: used,
      maxTokens: max,
      percentage: Math.round((used / max) * 1000) / 10,
      categories: [],
      at: Date.now(),
    };
    this.emit({ type: "context", context });
  }

  // What a finished prompt spent. The CLI counts cached tokens in its input.
  spent(usage: P | undefined): void {
    if (!usage) return;
    const read = Number(usage.cachedReadTokens) || 0;
    const written = Number(usage.cachedWriteTokens) || 0;
    const input = Number(usage.inputTokens) || 0;
    this.totals.inputTokens += Math.max(0, input - read - written);
    this.totals.outputTokens += Number(usage.outputTokens) || 0;
    this.totals.cacheReadTokens += read;
    this.totals.cacheWriteTokens += written;
  }

  endTurn(end: { interrupted?: boolean; error?: string }): void {
    this.close();
    this.emit({ type: "usage", totals: { ...this.totals } });
    this.items.endTurn(end);
  }
}
