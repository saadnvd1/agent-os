import { randomUUID } from "crypto";
import type { DriverEvent, FileDiff, UsageTotals } from "../events";
import { toolTitle } from "../tools";
import { unifiedToDiff } from "../diff";
import { TurnItems, type ToolStart } from "./turn-items";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface CodexChange {
  path: string;
  kind?: { type?: string };
  diff?: string;
}

// The command a shell was asked to run, without the shell around it.
export function shellCommand(command: unknown): string {
  const inner = str(command).replace(/^\/bin\/\w+ -l?c /, "");
  const quoted = inner.match(/^(["'])([\s\S]*)\1$/);
  if (!quoted) return inner;
  return quoted[1] === '"'
    ? quoted[2].replace(/\\(["\\$`])/g, "$1")
    : quoted[2];
}

export function changeDiff(changes: CodexChange[]): FileDiff | undefined {
  const c = changes[0];
  if (!c?.path) return undefined;
  return unifiedToDiff(c.path, c.diff ?? "", c.kind?.type === "add");
}

function toolStart(item: P): ToolStart | null {
  switch (item.type) {
    case "commandExecution": {
      const command = shellCommand(item.command);
      return {
        name: "Bash",
        title: toolTitle("Bash", { command }),
        input: { command, cwd: item.cwd },
      };
    }
    case "fileChange": {
      const changes = (item.changes as CodexChange[]) ?? [];
      const name = changes[0]?.kind?.type === "add" ? "Write" : "Edit";
      const more = changes.length > 1 ? ` (+${changes.length - 1} more)` : "";
      return {
        name,
        title: `${toolTitle(name, { file_path: changes[0]?.path })}${more}`,
        input: { changes: changes.map((c) => c.path) },
        diff: changeDiff(changes),
      };
    }
    case "mcpToolCall": {
      const name = `mcp__${str(item.server)}__${str(item.tool)}`;
      return { name, title: toolTitle(name, {}), input: item.arguments };
    }
    case "dynamicToolCall":
      return {
        name: str(item.tool),
        title: str(item.tool),
        input: item.arguments,
      };
    case "webSearch": {
      const query = str(item.query) || str((item.action as P)?.query);
      return {
        name: "WebSearch",
        title: query ? toolTitle("WebSearch", { query }) : "Search the web",
        input: { query },
      };
    }
    default:
      return null;
  }
}

function toolOutput(item: P): string | undefined {
  if (item.type === "commandExecution") return str(item.aggregatedOutput);
  if (item.type === "mcpToolCall") {
    const error = (item.error as P | null)?.message;
    if (error) return str(error);
    const content = ((item.result as P | null)?.content ?? []) as P[];
    return content.map((c) => str(c.text)).join("\n");
  }
  return undefined;
}

const TODO_STATUS = {
  pending: "pending",
  inProgress: "in_progress",
  completed: "completed",
} as const;

// Codex app-server notifications as chat items. One per conversation.
export class CodexMapper {
  readonly items: TurnItems;
  private totals: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  private turnError: string | null = null;
  activeTurn: string | null = null;

  constructor(private emit: (e: DriverEvent) => void) {
    this.items = new TurnItems(emit);
  }

  map(method: string, p: P): void {
    const item = (p.item ?? {}) as P;
    const id = str(item.id) || str(p.itemId);
    switch (method) {
      case "turn/started":
        this.activeTurn = str((p.turn as P)?.id) || this.activeTurn;
        this.turnError = null;
        return this.items.startTurn();
      case "turn/completed":
        return this.completed((p.turn ?? {}) as P);
      case "item/agentMessage/delta":
        return this.items.delta(id, "assistant", str(p.delta));
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        return this.items.delta(id, "reasoning", str(p.delta));
      case "item/reasoning/summaryPartAdded":
        if (this.items.hasText(id)) this.items.delta(id, "reasoning", "\n\n");
        return;
      case "item/started":
        return this.started(id, item);
      case "item/completed":
        return this.finished(id, item);
      case "turn/plan/updated":
        return this.items.todos(
          ((p.plan as P[]) ?? []).map((t) => ({
            text: str(t.step),
            status:
              TODO_STATUS[str(t.status) as keyof typeof TODO_STATUS] ??
              "pending",
          }))
        );
      case "thread/tokenUsage/updated":
        return this.usage(p.tokenUsage as P);
      case "error":
        if (!p.willRetry)
          this.turnError = str((p.error as P)?.message) || "Codex failed";
        return;
    }
  }

  private started(id: string, item: P): void {
    const start = toolStart(item);
    if (start) this.items.tool(id, start);
  }

  private finished(id: string, item: P): void {
    if (item.type === "agentMessage")
      return this.items.finishText(
        id,
        "assistant",
        str(item.text) || undefined
      );
    if (item.type === "reasoning")
      return this.items.finishText(id, "reasoning");
    if (item.type === "contextCompaction")
      return this.emit({
        type: "item",
        item: { id: randomUUID(), kind: "compacted", createdAt: Date.now() },
      });
    const start = toolStart(item);
    if (!start) return;
    if (!this.items.hasTool(id)) this.items.tool(id, start);
    const status = str(item.status);
    this.items.toolDone(
      id,
      status === "failed"
        ? "error"
        : status === "declined"
          ? "stopped"
          : "done",
      toolOutput(item),
      start
    );
  }

  private usage(u: P | undefined): void {
    const last = (u?.last ?? {}) as Record<string, number>;
    this.context(u, last.totalTokens ?? 0);
    // Resuming reports the thread's last use; only a turn spends.
    if (!this.items.inTurn) return;
    const input = last.inputTokens ?? 0;
    const cached = last.cachedInputTokens ?? 0;
    const written = last.cacheWriteInputTokens ?? 0;
    this.totals = {
      costUsd: 0,
      inputTokens:
        this.totals.inputTokens + Math.max(0, input - cached - written),
      outputTokens: this.totals.outputTokens + (last.outputTokens ?? 0),
      cacheReadTokens: this.totals.cacheReadTokens + cached,
      cacheWriteTokens: this.totals.cacheWriteTokens + written,
    };
  }

  private context(u: P | undefined, used: number): void {
    const max = Number(u?.modelContextWindow) || 0;
    if (!max) return;
    this.emit({
      type: "context",
      context: {
        usedTokens: used,
        maxTokens: max,
        percentage: Math.round((used / max) * 1000) / 10,
        categories: [],
        at: Date.now(),
      },
    });
  }

  private completed(turn: P): void {
    this.activeTurn = null;
    const status = str(turn.status);
    const error =
      status === "failed"
        ? str((turn.error as P)?.message) || this.turnError || "The turn failed"
        : this.turnError;
    this.emit({ type: "usage", totals: { ...this.totals } });
    this.items.endTurn({
      interrupted: status === "interrupted",
      error: error ?? undefined,
    });
    this.turnError = null;
  }
}
