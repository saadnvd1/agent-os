import { randomUUID } from "crypto";
import type { DriverEvent, UsageTotals } from "../events";
import { openCodeTool } from "./opencode-rules";
import { TurnItems } from "./turn-items";
import {
  logTurnEnd,
  needsSummary,
  stalledNotice,
  turnOutcome,
  type TurnEnded,
} from "./turn-outcome";
import { retryNotice, TurnRetry, type RetryDecision } from "./transient-retry";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => Number(v) || 0;

// A prompt this big (tokens) is worth compacting before the last retry.
const HEAVY_TOKENS = 16_000;

// Events that show the session is alive; a retry notice is not one.
const PROGRESS = /^(message\.|session\.(status|compacted|error)|todo\.)/;

const TODO = new Set(["pending", "in_progress", "completed"]);

// OpenCode's event stream as chat items, for one session (its subagents'
// sessions stay inside their task's tool card).
export class OpenCodeMapper {
  readonly items: TurnItems;
  // Each message's role.
  private roles = new Map<string, string>();
  // Each text part's kind, and how much of it has been shown.
  private parts = new Map<
    string,
    { kind: "assistant" | "reasoning"; shown: number }
  >();
  private counted = new Set<string>();
  // Messages and parts of turns that have ended: a late update to one
  // (the stopped message's error, its last text) belongs to that turn.
  private current = new Set<string>();
  private past = new Set<string>();
  private error: string | null = null;
  // The turn's last assistant message: its finish reason, text and calls.
  private last = {
    id: "",
    finish: "",
    provider: "",
    model: "",
    text: new Map<string, string>(),
    calls: new Set<string>(),
  };
  private aborted = false;
  // Tool calls this turn, kept through the nudged run that continues it.
  private toolIds = new Set<string>();
  private nudged = false;
  private nudgeDue = false;
  // Idle from before the prompt is stale until the session goes busy.
  private admitted = false;
  totals: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  // Retrying a turn the model's server dropped.
  readonly retry = new TurnRetry();
  // OpenCode retried the failure itself: AgentOS adds nothing on top.
  private agentRetried = false;
  // The last answer's prompt size, to judge whether compacting would help.
  lastInputTokens = 0;
  // Compacting between retries makes the session busy and idle: not a turn.
  private holding = false;
  // OpenCode is compacting the context (its summary request is out).
  private compacting = false;
  // A compaction ran in this turn; the messages that are its summary.
  private compacted = false;
  private summaries = new Set<string>();
  // Tool calls not finished yet: the turn waits on them, not on the model.
  private open = new Set<string>();
  // When the session last did anything: the stall watchdog's clock.
  private progressAt = Date.now();

  constructor(
    private sessionId: () => string | null,
    private emit: (e: DriverEvent) => void,
    // Called when a failed turn is to be tried again.
    private onRetry: (
      d: Extract<RetryDecision, { retry: true }>,
      error: string
    ) => void = () => {}
  ) {
    this.items = new TurnItems(emit);
  }

  // A prompt went out: its turn starts now. A retry is the same turn.
  prompted(retried = false): void {
    this.retrying = false;
    if (!retried) {
      this.retry.reset();
      this.agentRetried = false;
    }
    this.admitted = false;
    this.progressAt = Date.now();
    this.items.startTurn();
  }

  // How long the turn has waited on the model without a sign of life; 0
  // while it isn't waiting on one (a tool runs, a retry is queued).
  silentMs(now = Date.now()): number {
    if (!this.items.inTurn || this.holding || this.retrying || this.open.size)
      return 0;
    return Math.max(0, now - this.progressAt);
  }

  map(e: P): void {
    const p = (e.properties ?? {}) as P;
    if (p.sessionID && p.sessionID !== this.sessionId()) return;
    if (
      PROGRESS.test(e.type as string) &&
      !(e.type === "session.status" && str((p.status as P)?.type) === "retry")
    )
      this.progressAt = Date.now();
    switch (e.type) {
      case "session.status": {
        const type = str((p.status as P)?.type);
        if (type === "retry") this.agentRetried = true;
        if (type === "busy" || type === "retry") {
          this.admitted = true;
          this.items.startTurn();
          if (type === "retry") {
            const st = p.status as P;
            this.emit({
              type: "model_retry",
              attempt: num(st.attempt) || 1,
              message: str(st.message) || undefined,
            });
          }
        } else if (type === "idle") this.idle();
        return;
      }
      case "session.idle":
        return this.idle();
      case "session.error":
        return this.failed(p.error as P | undefined);
      case "session.compacted":
        this.compacted = true;
        this.setCompacting(false);
        return this.emit({
          type: "item",
          item: { id: randomUUID(), kind: "compacted", createdAt: Date.now() },
        });
      case "message.updated":
        return this.message(p.info as P);
      case "message.part.updated":
        return this.part(p.part as P);
      case "message.part.delta":
        return this.delta(p);
      case "todo.updated":
        return this.items.todos(
          ((p.todos as P[]) ?? [])
            .filter((t) => str(t.status) !== "cancelled")
            .map((t) => ({
              text: str(t.content),
              status: TODO.has(str(t.status))
                ? (str(t.status) as "pending")
                : "pending",
            }))
        );
    }
  }

  private message(info: P | undefined): void {
    if (!info) return;
    const id = str(info.id);
    if (this.past.has(id)) return;
    this.current.add(id);
    this.roles.set(id, str(info.role));
    if (info.role !== "assistant") return;
    const summary =
      info.summary === true ||
      info.mode === "compaction" ||
      info.agent === "compaction";
    if (summary) {
      this.summaries.add(id);
      this.setCompacting(!(info.time as P)?.completed && !info.error);
    }
    if (!summary && this.last.id !== id)
      this.last = {
        id,
        finish: "",
        provider: "",
        model: "",
        text: new Map(),
        calls: new Set(),
      };
    if (!summary) {
      this.last.finish = str(info.finish) || this.last.finish;
      this.last.provider = str(info.providerID) || this.last.provider;
      this.last.model = str(info.modelID) || this.last.model;
    }
    if (info.error) this.failed(info.error as P);
    if (!(info.time as P)?.completed || this.counted.has(id)) return;
    this.counted.add(id);
    const t = (info.tokens ?? {}) as P;
    const cache = (t.cache ?? {}) as P;
    this.lastInputTokens = num(t.input) + num(cache.read);
    if (this.lastInputTokens + num(cache.write) > 0)
      this.emit({
        type: "prompt_tokens",
        tokens: this.lastInputTokens + num(cache.write),
      });
    this.totals = {
      costUsd: this.totals.costUsd + num(info.cost),
      inputTokens: this.totals.inputTokens + num(t.input),
      outputTokens: this.totals.outputTokens + num(t.output) + num(t.reasoning),
      cacheReadTokens: this.totals.cacheReadTokens + num(cache.read),
      cacheWriteTokens: this.totals.cacheWriteTokens + num(cache.write),
    };
  }

  private part(part: P | undefined): void {
    if (!part) return;
    const id = str(part.id);
    if (this.past.has(id) || this.past.has(str(part.messageID))) return;
    this.current.add(id);
    // A compaction starts as a part of the message that asks for it.
    if (part.type === "compaction") return this.setCompacting(true);
    // Only the agent's own messages: the prompt comes back as a part too.
    if (this.roles.get(str(part.messageID)) !== "assistant") return;
    // The summary is the agent's memory, not part of the reply.
    if (this.summaries.has(str(part.messageID))) return;
    if (part.type === "text" || part.type === "reasoning") {
      if (part.synthetic || part.ignored) return;
      const kind = part.type === "text" ? "assistant" : "reasoning";
      const seen = this.parts.get(id) ?? { kind, shown: 0 };
      this.parts.set(id, seen);
      const text = str(part.text);
      if (kind === "assistant" && this.last.id === str(part.messageID))
        this.last.text.set(id, text);
      if (text.length > seen.shown) {
        this.items.delta(id, kind, text.slice(seen.shown));
        seen.shown = text.length;
      }
      if ((part.time as P)?.end) this.items.finishText(id, kind, text);
      return;
    }
    if (part.type === "tool") {
      this.toolIds.add(id);
      const done = ["completed", "error"].includes(
        str((part.state as P | undefined)?.status)
      );
      if (done) this.open.delete(id);
      else this.open.add(id);
      if (this.last.id === str(part.messageID)) this.last.calls.add(id);
      this.tool(id, part);
    }
  }

  private delta(p: P): void {
    if (this.past.has(str(p.partID))) return;
    const seen = this.parts.get(str(p.partID));
    if (!seen || p.field !== "text") return;
    const text = str(p.delta);
    if (seen.kind === "assistant" && this.last.text.has(str(p.partID)))
      this.last.text.set(
        str(p.partID),
        this.last.text.get(str(p.partID)) + text
      );
    seen.shown += text.length;
    this.items.delta(str(p.partID), seen.kind, text);
  }

  private tool(id: string, part: P): void {
    const state = (part.state ?? {}) as P;
    const status = str(state.status);
    const tool = str(part.tool);
    if (tool === "todowrite" || status === "pending") return;
    const start = openCodeTool(tool, state.input);
    if (!this.items.hasTool(id)) this.items.tool(id, start);
    if (status === "running")
      this.items.progress(id, str((state.metadata as P | undefined)?.output));
    else if (status === "completed")
      this.items.toolDone(id, "done", str(state.output), start);
    else if (status === "error")
      this.items.toolDone(id, "error", str(state.error), start);
  }

  private setCompacting(on: boolean): void {
    if (on === this.compacting) return;
    this.compacting = on;
    this.emit({ type: "compacting", active: on });
  }

  private failed(error: P | undefined): void {
    if (!error) return;
    this.setCompacting(false);
    if (error.name === "MessageAbortedError") this.aborted = true;
    else
      this.error =
        str((error.data as P)?.message) || str(error.name) || "OpenCode failed";
  }

  // A turn that failed on a dropped request goes on in place: the notice,
  // then the driver sends the prompt again. False when it should end.
  private retryTurn(): boolean {
    const error = this.error ?? "";
    const d = this.retry.next({
      error,
      harnessRetried: this.agentRetried,
      contextHeavy: this.lastInputTokens >= HEAVY_TOKENS,
    });
    if (!d.retry) return false;
    this.items.note(retryNotice(d, error));
    this.clearTurn();
    this.retrying = true;
    this.onRetry(d, error);
    return true;
  }

  private clearTurn(): void {
    this.error = null;
    this.last.id = "";
    this.toolIds.clear();
    this.aborted = false;
    this.admitted = false;
    for (const id of this.current) this.past.add(id);
    this.current.clear();
    this.parts.clear();
    this.open.clear();
    this.summaries.clear();
    this.compacted = false;
  }

  // A failed turn is waiting for its retry to go out.
  retrying = false;

  // The reader stopped the turn while it waited to retry.
  stopRetrying(): void {
    this.retrying = false;
    this.holding = false;
    this.emit({ type: "usage", totals: { ...this.totals } });
    this.items.endTurn({ interrupted: true });
  }

  holdIdle(on: boolean): void {
    this.holding = on;
  }

  private idle(): void {
    if (this.holding || !this.admitted || !this.items.inTurn) return;
    this.setCompacting(false);
    if (this.error && !this.aborted && this.retryTurn()) return;
    this.emit({ type: "usage", totals: { ...this.totals } });
    const text = [...this.last.text.values()].join("\n");
    if (
      !this.nudged &&
      needsSummary({
        toolsRun: this.toolIds.size,
        text,
        toolCalls: this.last.calls.size,
        finishReason: this.last.finish,
        error: this.error ?? undefined,
        aborted: this.aborted,
      })
    ) {
      // The turn stays open: the driver asks for the summary, once.
      this.nudged = this.nudgeDue = true;
      this.last.id = "";
      this.admitted = false;
      console.info("[chat] asked the model for its results summary");
      return;
    }
    const ended = this.aborted
      ? undefined
      : turnOutcome({
          finishReason: this.last.finish,
          text,
          toolCalls: this.last.calls.size,
          compacted: this.compacted,
          toolsDone: /tool/i.test(this.last.finish) && !this.open.size,
          error: this.error ?? undefined,
          retries: this.retry.tried,
          agentRetried: this.agentRetried,
          summary: this.items.summary(),
        });
    this.finish(ended, text);
    this.clearTurn();
    this.nudged = this.nudgeDue = false;
  }

  // The turn is over: the end told, then the state reset.
  private finish(ended: TurnEnded | undefined, text: string): void {
    if (ended)
      logTurnEnd({
        driver: "opencode",
        provider: this.last.provider,
        model: this.last.model,
        finishReason: this.last.finish,
        reason: ended.reason,
        text,
      });
    this.items.endTurn({
      interrupted: this.aborted,
      error: this.error ?? undefined,
      finishReason: this.last.finish || undefined,
      ended,
    });
  }

  // The model stayed silent past the limit: the driver stops the session and
  // the turn ends here, with what it got through kept.
  stalled(ms: number): void {
    if (!this.items.inTurn) return;
    const compacting = this.compacting;
    this.setCompacting(false);
    this.retrying = false;
    this.emit({ type: "usage", totals: { ...this.totals } });
    const ended: TurnEnded = {
      reason: "stalled",
      notice: stalledNotice(ms, compacting),
    };
    this.finish(ended, "");
    this.clearTurn();
    this.nudged = this.nudgeDue = false;
  }

  // True once after a turn ended without its results: send SUMMARY_NUDGE.
  takeNudge(): boolean {
    const due = this.nudgeDue;
    this.nudgeDue = false;
    return due;
  }

  // The prompt never reached a busy session (it failed, or finished before
  // the stream said so): the turn ends anyway.
  settle(): void {
    this.admitted = true;
    this.idle();
  }
}
