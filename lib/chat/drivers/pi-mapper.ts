import { randomUUID } from "crypto";
import type { DriverEvent, UsageTotals } from "../events";
import { toolDiff, toolTitle } from "../tools";
import { TurnItems, type ToolStart } from "./turn-items";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

const NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
};

// A Pi tool call in the shape the chat's tool cards know (Claude's names
// and fields), so titles and diffs read the same for every agent.
export function piTool(tool: string, args: unknown): ToolStart {
  const a = (args ?? {}) as P;
  const name = NAMES[tool] ?? tool;
  let input: P = a;
  if (tool === "read" || tool === "write") input = { ...a, file_path: a.path };
  if (tool === "ls") input = { ...a, file_path: a.path };
  if (tool === "edit") {
    const edits = Array.isArray(a.edits)
      ? (a.edits as P[])
      : [{ oldText: a.oldText, newText: a.newText }];
    input = {
      file_path: a.path,
      old_string: edits.map((e) => str(e.oldText)).join("\n…\n"),
      new_string: edits.map((e) => str(e.newText)).join("\n…\n"),
    };
  }
  const title =
    tool === "ls" ? `List ${str(a.path) || "."}` : toolTitle(name, input);
  return { name, title, input, diff: toolDiff(name, input) };
}

export const resultText = (result: unknown) =>
  (((result as P | undefined)?.content as P[] | undefined) ?? [])
    .map((c) => str(c.text))
    .join("\n");

// Pi's RPC events as chat items. One per conversation.
export class PiMapper {
  readonly items: TurnItems;
  private message = 0;
  private stopReason = "";
  private error = "";
  totals: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  constructor(private emit: (e: DriverEvent) => void) {
    this.items = new TurnItems(emit);
  }

  // The last answer in the run stopped because the reader stopped it.
  get aborted(): boolean {
    return this.stopReason === "aborted";
  }

  map(e: P): void {
    switch (e.type) {
      case "agent_start":
        this.stopReason = this.error = "";
        return this.items.startTurn();
      case "message_start":
        if ((e.message as P)?.role === "assistant") this.message++;
        return;
      case "message_update":
        return this.update(e.assistantMessageEvent as P);
      case "message_end":
        return this.ended(e.message as P);
      case "tool_execution_start":
        return this.items.tool(
          str(e.toolCallId),
          piTool(str(e.toolName), e.args)
        );
      case "tool_execution_end":
        return this.items.toolDone(
          str(e.toolCallId),
          e.isError ? "error" : "done",
          resultText(e.result)
        );
      case "compaction_end":
        if (!e.result) return;
        return this.emit({
          type: "item",
          item: {
            id: randomUUID(),
            kind: "compacted",
            trigger: e.reason === "manual" ? "manual" : "auto",
            createdAt: Date.now(),
          },
        });
    }
  }

  private update(a: P | undefined): void {
    if (!a) return;
    const key = `${this.message}:${a.contentIndex}`;
    switch (a.type) {
      case "text_delta":
        return this.items.delta(key, "assistant", str(a.delta));
      case "thinking_delta":
        return this.items.delta(key, "reasoning", str(a.delta));
      case "text_end":
        return this.items.finishText(
          key,
          "assistant",
          str(a.content) || undefined
        );
      case "thinking_end":
        return this.items.finishText(
          key,
          "reasoning",
          str(a.content) || undefined
        );
    }
  }

  private ended(m: P | undefined): void {
    if (m?.role !== "assistant") return;
    this.stopReason = str(m.stopReason);
    if (this.stopReason === "error")
      this.error = str(m.errorMessage) || "Pi failed";
    const u = (m.usage ?? {}) as P;
    const n = (k: string) => Number(u[k]) || 0;
    this.totals = {
      costUsd: this.totals.costUsd + (Number((u.cost as P)?.total) || 0),
      inputTokens: this.totals.inputTokens + n("input"),
      outputTokens: this.totals.outputTokens + n("output"),
      cacheReadTokens: this.totals.cacheReadTokens + n("cacheRead"),
      cacheWriteTokens: this.totals.cacheWriteTokens + n("cacheWrite"),
    };
  }

  // The run is over: Pi has nothing left to do for it.
  endTurn(): void {
    if (!this.items.inTurn) return;
    this.emit({ type: "usage", totals: { ...this.totals } });
    this.items.endTurn({
      interrupted: this.aborted,
      error: this.error || undefined,
    });
  }
}
