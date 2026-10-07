// At most one phone notification a minute from each source. A message
// inside that minute waits and goes out with any others as one; the same
// text twice in a minute goes once.

export const WINDOW_MS = 60_000;

export type Outcome =
  | { state: "sent" }
  | { state: "held"; inMs: number }
  | { state: "duplicate" }
  | { state: "failed"; why: string };

interface SourceState {
  lastAt: number;
  lastText: string;
  pending: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

export function collapse(texts: string[]): string {
  if (texts.length === 1) return texts[0];
  return `${texts.length} updates:\n${texts.map((t) => `• ${t}`).join("\n")}`;
}

export class Limiter {
  private sources = new Map<string, SourceState>();

  constructor(
    private send: (text: string) => Promise<void>,
    private opts: {
      now?: () => number;
      windowMs?: number;
      onLate?: (source: string, error: unknown) => void;
    } = {}
  ) {}

  private get now() {
    return this.opts.now?.() ?? Date.now();
  }
  private get windowMs() {
    return this.opts.windowMs ?? WINDOW_MS;
  }

  async push(source: string, text: string): Promise<Outcome> {
    const s = this.sources.get(source) ?? {
      lastAt: -Infinity,
      lastText: "",
      pending: [],
      timer: null,
    };
    this.sources.set(source, s);
    const now = this.now;
    const recent = now - s.lastAt < this.windowMs;
    if ((recent && s.lastText === text) || s.pending.includes(text))
      return { state: "duplicate" };
    if (recent || s.timer) {
      s.pending.push(text);
      const inMs = Math.max(0, s.lastAt + this.windowMs - now);
      if (!s.timer) {
        s.timer = setTimeout(() => void this.flush(source), inMs);
        s.timer.unref?.();
      }
      return { state: "held", inMs };
    }
    s.lastAt = now;
    s.lastText = text;
    try {
      await this.send(text);
      return { state: "sent" };
    } catch (error) {
      return {
        state: "failed",
        why: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Sends what waited, as one message.
  async flush(source: string): Promise<void> {
    const s = this.sources.get(source);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (!s.pending.length) return;
    const text = collapse(s.pending);
    s.pending = [];
    s.lastAt = this.now;
    s.lastText = text;
    try {
      await this.send(text);
    } catch (error) {
      this.opts.onLate?.(source, error);
    }
  }
}
