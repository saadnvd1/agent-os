/**
 * The demo's stand-in for an agent (AGENTOS_DEMO=1): no process, no tools,
 * just a short canned reply streamed the way a real one is, so the chat
 * flow still works end to end.
 */

import type { ChatConversation, ChatDriver } from "../driver";
import type { DriverEvent } from "../events";

export const DEMO_REPLY =
  "This is a demo, so agents don't run here. On your own machine, this is where the agent would answer and get to work.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Events pushed by sends and read by one consumer, in order.
function channel() {
  const queue: DriverEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(e: DriverEvent) {
      queue.push(e);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *events(): AsyncIterable<DriverEvent> {
      while (true) {
        const next = queue.shift();
        if (next) yield next;
        else if (closed) return;
        else await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

export function demoConversation(stepMs = 40): ChatConversation {
  const out = channel();
  let turn = Promise.resolve();
  let stopped = false;
  const reply = async () => {
    stopped = false;
    const started = Date.now();
    const id = `assistant-${started}-${Math.random().toString(36).slice(2, 7)}`;
    out.push({ type: "state", state: "running" });
    out.push({ type: "turn_start" });
    out.push({
      type: "item",
      item: {
        id,
        kind: "assistant",
        text: "",
        streaming: true,
        createdAt: started,
      },
    });
    const words = DEMO_REPLY.split(/(?<= )/);
    let i = 0;
    for (; i < words.length && !stopped; i++) {
      await sleep(stepMs);
      out.push({ type: "delta", id, text: words[i] });
    }
    out.push({
      type: "item",
      item: {
        id,
        kind: "assistant",
        text: words.slice(0, i).join(""),
        createdAt: started,
      },
    });
    out.push({
      type: "item",
      item: {
        id: `end-${id}`,
        kind: "turn_end",
        durationMs: Date.now() - started,
        interrupted: stopped || undefined,
        createdAt: Date.now(),
      },
    });
    out.push({ type: "state", state: "idle" });
  };
  const refuse = async () => {
    throw new Error("Not available in the demo.");
  };
  return {
    send() {
      turn = turn.then(reply);
      return undefined;
    },
    async interrupt() {
      stopped = true;
    },
    setModel: async () => {},
    setAccess: async () => {},
    setPlan: refuse,
    respond: () => {},
    stopTask: async () => {},
    undo: refuse,
    close: () => out.close(),
    events: out.events(),
  };
}

export const demoDriver: ChatDriver = {
  id: "demo",
  plan: false,
  inProcessTools: false,
  start: () => demoConversation(),
  discover: async () => ({ commands: [], models: [] }),
};
