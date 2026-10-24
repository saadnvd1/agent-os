import { randomUUID } from "crypto";
import type { DriverEvent, UsageTotals } from "../events";
import { toolDiff, toolTitle } from "../tools";
import { TurnItems, type ToolStart } from "./turn-items";
import { logTurnEnd, needsSummary, turnOutcome } from "./turn-outcome";
import {
  COMPACT_AT_PERCENT,
  retryNotice,
  TurnRetry,
  type RetryDecision,
} from "./transient-retry";

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
  // The last answer's text, its tool calls and who gave it, for the notice
  // when a turn ends without doing anything.
  private toolsRun = 0;
  private last = { text: "", calls: 0, provider: "", model: "", api: "" };
  totals: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  // Retrying a turn the model's server dropped, when Pi didn't.
  readonly retry = new TurnRetry();
  private agentRetried = false;
  // A failed turn is waiting for its retry to go out.
  retrying = false;
  // The context's fill, as last reported.
  contextPercent = 0;

  constructor(
    private emit: (e: DriverEvent) => void,
    // Called when a failed turn is to be tried again.
    private onRetry: (
      d: Extract<RetryDecision, { retry: true }>,
      error: string
    ) => void = () => {}
  ) {
    this.items = new TurnItems(emit);
  }

  // The reader sent a message: a new turn's retries start over.
  userPrompt(): void {
    this.retry.reset();
    this.agentRetried = false;
  }

  // The last answer in the run stopped because the reader stopped it.
  get aborted(): boolean {
    return this.stopReason === "aborted";
  }

  map(e: P): void {
    switch (e.type) {
      case "agent_start":
        // A nudged run continues the same turn, so its tools still count.
        if (!this.items.inTurn) this.toolsRun = 0;
        this.stopReason = this.error = "";
        this.last = { text: "", calls: 0, provider: "", model: "", api: "" };
        return this.items.startTurn();
      case "message_start":
        if ((e.message as P)?.role === "assistant") this.message++;
        return;
      case "message_update":
        return this.update(e.assistantMessageEvent as P);
      case "message_end":
        return this.ended(e.message as P);
      case "tool_execution_start":
        this.toolsRun++;
        return this.items.tool(
          str(e.toolCallId),
          piTool(str(e.toolName), e.args)
        );
      case "tool_execution_update":
        return this.items.progress(
          str(e.toolCallId),
          resultText(e.partialResult)
        );
      case "tool_execution_end":
        return this.items.toolDone(
          str(e.toolCallId),
          e.isError ? "error" : "done",
          resultText(e.result)
        );
      case "auto_retry_start":
        this.agentRetried = true;
        return this.items.note(
          `Pi is trying again (${str(e.attempt)} of ${str(e.maxAttempts)}): ${str(e.errorMessage).slice(0, 160)}`
        );
      case "auto_retry_end":
        if (e.success === false && e.finalError && !this.error)
          this.error = str(e.finalError);
        return;
      case "compaction_start":
        return this.emit({ type: "compacting", active: true });
      case "compaction_end":
        // Failed or not, it's over.
        this.emit({ type: "compacting", active: false });
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
    const content = Array.isArray(m.content) ? (m.content as P[]) : [];
    this.last = {
      text: content
        .filter((c) => c.type === "text")
        .map((c) => str(c.text))
        .join("\n"),
      calls: content.filter((c) => c.type === "toolCall").length,
      provider: str(m.provider),
      model: str(m.model),
      api: str(m.api),
    };
    // Calls the text-tools extension made out of the reply's markup: the
    // text that streamed still has it.
    const fixed = m.aosRecovered as P | undefined;
    if (fixed)
      this.items.retext(`${this.message}:${fixed.index}`, str(fixed.text));
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

  // The run ran tools and ended without saying what they found.
  needsSummary(): boolean {
    return needsSummary({
      toolsRun: this.toolsRun,
      text: this.last.text,
      toolCalls: this.last.calls,
      finishReason: this.stopReason,
      error: this.error || undefined,
      aborted: this.aborted,
    });
  }

  private retryTurn(): boolean {
    const d = this.retry.next({
      error: this.error,
      harnessRetried: this.agentRetried,
      contextHeavy: this.contextPercent >= COMPACT_AT_PERCENT,
    });
    if (!d.retry) return false;
    this.items.note(retryNotice(d, this.error));
    this.retrying = true;
    this.onRetry(d, this.error);
    return true;
  }

  // The reader stopped the turn while it waited to retry.
  stopRetrying(): void {
    this.retrying = false;
    this.emit({ type: "usage", totals: { ...this.totals } });
    this.items.endTurn({ interrupted: true });
  }

  // The run is over: Pi has nothing left to do for it.
  endTurn(): void {
    if (!this.items.inTurn) return;
    if (this.error && !this.aborted && this.retryTurn()) return;
    this.retrying = false;
    this.emit({ type: "usage", totals: { ...this.totals } });
    const ended = this.aborted
      ? undefined
      : turnOutcome({
          finishReason: this.stopReason,
          text: this.last.text,
          toolCalls: this.last.calls,
          error: this.error || undefined,
          retries: this.retry.tried,
          agentRetried: this.agentRetried,
          summary: this.items.summary(),
        });
    if (ended)
      logTurnEnd({
        driver: "pi",
        ...this.last,
        finishReason: this.stopReason,
        reason: ended.reason,
      });
    this.items.endTurn({
      interrupted: this.aborted,
      error: this.error || undefined,
      finishReason: this.stopReason || undefined,
      ended,
    });
  }
}
