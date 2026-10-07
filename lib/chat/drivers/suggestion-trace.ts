import type { ClaudeMessage } from "./claude-mapper";

// One worker-log line per turn about the agent's guess at the next message:
// the guess, or what the stream showed when none came. The CLI drops it
// without a word (the first turn, an API error, plan mode, near the usage
// limit, a cold prompt cache, a guess that fails its own filters, or a new
// message before it was ready), so the log is the only trace.
export class SuggestionTrace {
  private turns = 0;
  // The last turn to end, until its guess arrives or can't any more.
  private ended: {
    turn: number;
    at: number;
    error: boolean;
    byAgent: boolean;
    usage?: Usage;
  } | null = null;
  private sends = 0;
  private rateLimit = "allowed";
  private lastUsage?: Usage;

  constructor(
    private readonly log: (line: string) => void,
    private readonly plan: () => boolean = () => false,
    private readonly now: () => number = Date.now
  ) {}

  message(m: ClaudeMessage): void {
    if (m.parent_tool_use_id) return;
    if (m.type === "rate_limit_event") {
      const status = (m as RateLimitMessage).rate_limit_info?.status;
      if (status && status !== this.rateLimit) {
        this.rateLimit = status;
        this.log(`[suggestion] rate limit now ${status}`);
      }
    } else if (m.type === "assistant") {
      this.lastUsage = m.message?.usage ?? this.lastUsage;
    } else if (m.type === "result") {
      this.miss("the next turn ended first");
      this.turns++;
      this.ended = {
        turn: this.turns,
        at: this.now(),
        error: !!m.is_error,
        // A turn nothing was sent for: a background task's notice.
        byAgent: this.sends === 0,
        usage: this.lastUsage,
      };
      this.sends = Math.max(0, this.sends - 1);
    } else if (m.type === "prompt_suggestion") {
      const e = this.ended;
      this.ended = null;
      this.log(
        `[suggestion] turn ${e?.turn ?? "?"}${e ? `, ${this.since(e.at)} after it ended` : ""}: ${JSON.stringify(m.suggestion ?? "")}`
      );
    }
  }

  // A message went in: the last turn's guess is stale now, and the CLI
  // stops making it.
  sent(): void {
    this.miss("a message was sent");
    this.sends++;
  }

  closed(): void {
    this.miss("the agent was closed");
  }

  private miss(why: string): void {
    const e = this.ended;
    if (!e) return;
    this.ended = null;
    const facts = [
      e.turn === 1 && "first turn of this process",
      e.error && "the turn failed",
      e.byAgent && "a turn the agent started",
      this.plan() && "plan mode",
      this.rateLimit !== "allowed" && `rate limit ${this.rateLimit}`,
      e.usage &&
        `last reply in ${e.usage.input_tokens ?? 0}, out ${e.usage.output_tokens ?? 0}, cache write ${e.usage.cache_creation_input_tokens ?? 0}`,
    ].filter(Boolean);
    this.log(
      `[suggestion] none for turn ${e.turn}: ${why} ${this.since(e.at)} after it ended${facts.length ? ` (${facts.join("; ")})` : ""}`
    );
  }

  private since(at: number): string {
    return `${((this.now() - at) / 1000).toFixed(1)}s`;
  }
}

type Usage = NonNullable<ClaudeMessage["message"]>["usage"];
type RateLimitMessage = { rate_limit_info?: { status?: string } };
