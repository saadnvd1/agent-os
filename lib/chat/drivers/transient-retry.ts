// Retrying a turn the model's server dropped. OpenCode and Pi retry some
// failures themselves (and say so); this covers the rest, with a hard limit
// so nothing loops: a few tries with growing waits, the last one on a
// smaller context, then the turn ends with a report.

export type ErrorKind = "timeout" | "transient";

export const MAX_RETRIES = 3;
const BASE_MS = 2_000;
// A context this full (percent of the window) is compacted before the last
// try: a request that took too long to start is the one that shrinks.
export const COMPACT_AT_PERCENT = 50;

const NEVER =
  /context (length|window)|maximum context|too many tokens|prompt is too long|\b40[0-4]\b|unauthori[sz]ed|invalid api key|authentication|forbidden|abort/i;
const TIMEOUT =
  /headers timed out|timed out|timeout|UND_ERR_(HEADERS|BODY|CONNECT)_TIMEOUT|ETIMEDOUT|ResponseStreamError/i;
const TRANSIENT =
  /fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|EPIPE|terminated|connection (lost|closed|reset)|ended without|overloaded|\b(429|500|502|503|504|524)\b|unavailable|rate limit/i;

// Whether a provider error is worth another try, and which kind it is.
export function classifyProviderError(message: string): ErrorKind | undefined {
  if (!message || NEVER.test(message)) return undefined;
  if (TIMEOUT.test(message)) return "timeout";
  if (TRANSIENT.test(message)) return "transient";
  return undefined;
}

export function backoffMs(attempt: number, jitter = true): number {
  const base = BASE_MS * 2 ** (attempt - 1);
  return jitter ? Math.round(base * (0.8 + Math.random() * 0.4)) : base;
}

export type RetryDecision =
  | { retry: true; attempt: number; delayMs: number; compactFirst: boolean }
  | { retry: false; attempts: number; kind?: ErrorKind };

// One per conversation. A turn that sends the user's message starts it over;
// a retry never does.
export class TurnRetry {
  private attempts = 0;

  constructor(private jitter = true) {}

  reset(): void {
    this.attempts = 0;
  }

  // Retries made in this turn.
  get tried(): number {
    return this.attempts;
  }

  next(o: {
    error: string;
    // The agent already retried this failure itself.
    harnessRetried?: boolean;
    // The context is big enough that compacting it is worth a try.
    contextHeavy?: boolean;
  }): RetryDecision {
    const kind = classifyProviderError(o.error);
    if (!kind || o.harnessRetried || this.attempts >= MAX_RETRIES)
      return { retry: false, attempts: this.attempts, kind };
    this.attempts++;
    return {
      retry: true,
      attempt: this.attempts,
      delayMs: backoffMs(this.attempts, this.jitter),
      compactFirst: this.attempts === MAX_RETRIES && !!o.contextHeavy,
    };
  }
}

// The message that resumes a turn after a failure: the steps that ran are
// already in the conversation.
export function continuePrompt(error: string): string {
  const why = error.replace(/\s+/g, " ").trim().slice(0, 200);
  return `The previous request to the model failed (${why}). Continue the task from where it stopped. The tool steps above already ran: don't redo them.`;
}

export function retryNotice(
  d: Extract<RetryDecision, { retry: true }>,
  error: string
): string {
  const why = error.replace(/\s+/g, " ").trim().slice(0, 160);
  return `The model's server didn't answer (${why}). Trying again in ${Math.round(d.delayMs / 1000)}s (${d.attempt} of ${MAX_RETRIES})${d.compactFirst ? ", after compacting the conversation" : ""}.`;
}
