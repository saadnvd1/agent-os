import type { ModelWait } from "./events";
import type { WorkerEvent } from "./worker/protocol";

// Follows a running turn's events to know when it is waiting on a model
// call: no tool running, nothing streaming, not compacting. Only what a
// driver measured is kept as the prompt size; nothing is guessed.
export class ModelWaitTracker {
  wait: ModelWait | null = null;
  private lastPrompt: number | undefined;
  private running = new Set<string>();
  private active = false;

  // Returns whether `wait` changed.
  on(e: WorkerEvent, now = Date.now()): boolean {
    const before = this.wait;
    switch (e.type) {
      case "state":
        if (e.state === "running") {
          if (!this.active) {
            this.active = true;
            this.begin(now);
          }
        } else this.end();
        break;
      case "item": {
        const i = e.item;
        if (i.kind === "turn_end") this.end();
        else if (i.kind === "compacted") this.lastPrompt = undefined;
        else if (i.kind === "tool") {
          if (i.status === "running") {
            this.running.add(i.id);
            this.wait = null;
          } else {
            this.running.delete(i.id);
            if (this.active && !this.running.size) this.begin(now);
          }
        } else if (i.kind === "assistant" || i.kind === "reasoning") {
          if (i.streaming) this.wait = null;
          else if (this.active && !this.running.size && !this.wait)
            this.begin(now);
        }
        break;
      }
      case "delta":
        this.wait = null;
        break;
      case "compacting":
        if (e.compacting) {
          this.wait = null;
          this.lastPrompt = undefined;
        } else if (this.active && !this.running.size) this.begin(now);
        break;
      case "prompt_tokens":
        this.lastPrompt = e.tokens;
        break;
      case "context":
        this.lastPrompt = e.context.usedTokens || this.lastPrompt;
        break;
      case "model_retry":
        if (this.active)
          this.wait = {
            ...(this.wait ?? this.fresh(now)),
            retry: { attempt: e.attempt, message: e.message },
          };
        break;
    }
    return (
      before !== this.wait &&
      JSON.stringify(before) !== JSON.stringify(this.wait)
    );
  }

  private fresh(now: number): ModelWait {
    return this.lastPrompt
      ? { since: now, promptTokens: this.lastPrompt }
      : { since: now };
  }

  private begin(now: number) {
    this.wait = this.fresh(now);
  }

  private end() {
    this.active = false;
    this.wait = null;
    this.running.clear();
  }
}
