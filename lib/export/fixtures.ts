// Invented chats and machine details for the export tests.
import type { ChatItem } from "../chat/events";
import type { ShareContext } from "../share/redact";

export const SECRET = ["gh", "p_", "a".repeat(36)].join("");
export const ctx: ShareContext = {
  home: "/Users/" + "fakeuser",
  user: "fakeuser",
  secrets: [],
  hosts: ["fake-mac.local"],
};

let t = Date.UTC(2026, 9, 21, 14, 0, 0);
export const resetClock = () => (t = Date.UTC(2026, 9, 21, 14, 0, 0));
let n = 0;

export const item = (i: Record<string, unknown>) =>
  ({ id: `i${++n}`, createdAt: (t += 1000), ...i }) as ChatItem;

export const lines = (count: number, prefix = "line") =>
  Array.from({ length: count }, (_, k) => `${prefix} ${k + 1}`).join("\n");

/** Two turns: a tool call with long output and a secret, then a short one. */
export function twoTurns(): ChatItem[] {
  return [
    item({ kind: "user", text: `fix it, token ${SECRET}`, midTurn: false }),
    item({ kind: "reasoning", text: "let me think" }),
    item({
      kind: "tool",
      name: "Bash",
      title: "run tests",
      input: { command: `cat ${ctx.home}/app/x.ts` },
      status: "done",
      output: lines(100),
    }),
    item({
      kind: "assistant",
      text: `done in ${ctx.home}/app on fake-mac.local`,
    }),
    item({ kind: "turn_end", durationMs: 4000, costUsd: 0.5 }),
    item({ kind: "user", text: "thanks", midTurn: false }),
    item({ kind: "assistant", text: "welcome" }),
    item({ kind: "turn_end", durationMs: 1000 }),
  ];
}
