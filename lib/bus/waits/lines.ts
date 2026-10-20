// Every text an agent reads about a wait. Each starts the way a bus message
// does, so a line left unsent in a terminal's input is recognised as ours.

import { shortId } from "../format";

const from = "[AgentOS message from AgentOS]";
const who = (name: string, id: string) => `"${name}" (${shortId(id)})`;

export const minutes = (ms: number) =>
  ms >= 3_600_000
    ? `${Math.round(ms / 360_000) / 10}h`
    : `${Math.max(1, Math.round(ms / 60_000))}m`;

export function nudgeLine(
  waiter: { id: string; name: string },
  request: string | null,
  messageId: number | null
): string {
  const reply = messageId ? ` --reply ${messageId}` : "";
  return `${from} ${who(waiter.name, waiter.id)} is waiting on your reply${request ? ` to: "${request}"` : ""}. Reply with: aos send ${shortId(waiter.id)}${reply} "<message>"`;
}

export function timeoutLine(
  target: { id: string; name: string },
  kind: "reply" | "idle" | "merged",
  waitedMs: number,
  request: string | null,
  targetIs: string
): string {
  const what =
    kind === "reply"
      ? `No reply from ${who(target.name, target.id)}${request ? ` to: "${request}"` : ""}`
      : kind === "idle"
        ? `${who(target.name, target.id)} didn't go idle`
        : `${who(target.name, target.id)}'s PR didn't merge`;
  return `${from} ${what} within ${minutes(waitedMs)}. The wait is closed; it is ${targetIs}. See what it did: aos read ${shortId(target.id)}`;
}

export const satisfiedLine = (
  target: { id: string; name: string },
  kind: "idle" | "merged",
  pr?: number | null
): string =>
  `${from} ${
    kind === "idle"
      ? `${who(target.name, target.id)} is idle now`
      : `${who(target.name, target.id)}'s PR${pr ? ` #${pr}` : ""} merged`
  } (you waited for that). See what it did: aos read ${shortId(target.id)}`;

export const endedLine = (
  target: { id: string; name: string },
  how: string,
  request: string | null
): string =>
  `${from} ${who(target.name, target.id)} ended (${how}) with your wait still open${request ? ` on: "${request}"` : ""}. It won't answer.`;

export const closedPrLine = (
  target: { id: string; name: string },
  pr: number | null
): string =>
  `${from} ${who(target.name, target.id)}'s PR${pr ? ` #${pr}` : ""} was closed without merging. The wait is closed.`;

export const orchestratorTimeoutLine = (
  waiter: string,
  target: string,
  waitedMs: number,
  request: string | null
): string =>
  `session ${waiter} waited ${minutes(waitedMs)} on ${target} with no ${request ? `reply to "${request}"` : "result"}; it has been told`;
