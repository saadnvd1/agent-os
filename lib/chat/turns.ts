import type { ChatItem, ChatOrigin } from "./events";
import { eventParts, originOf } from "./origin";

type UserItem = Extract<ChatItem, { kind: "user" }>;

// What the orchestrator's reply to an event ends up as in the timeline.
export interface EventTurn {
  // The event's own item id.
  id: string;
  user: UserItem;
  origin: ChatOrigin;
  // Everything after the event up to the end of the turn.
  replies: ChatItem[];
  // The start of the reply (or of the event, before it has one).
  summary: string;
  // The task or source it is about.
  task: string;
  at: number;
  // Still being answered.
  live: boolean;
  // The reply opened a question for the reader.
  hasQuestion: boolean;
}

const FOLDED_KINDS = new Set(["event", "peer", "schedule", "system"]);

// The origin of a user item when it is activity (an event, a task's message,
// a schedule) rather than something the reader said or decided. Items
// without a recorded origin are read by their text only if they predate it
// (originOf).
export function activityOrigin(item: UserItem): ChatOrigin | null {
  const origin = originOf(item);
  if (!origin || !FOLDED_KINDS.has(origin.kind)) return null;
  // A batch carrying the reader's own answers: the reply is to them.
  if (origin.decided?.length) return null;
  return origin;
}

export const isQuestionTool = (item: ChatItem): boolean =>
  item.kind === "tool" && /(^|__)question$/.test(item.name);

export function plainSummary(text: string, max = 140): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const plain = line
    .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function taskName(origin: ChatOrigin): string {
  const names = origin.subjects?.map((s) => s.name) ?? [];
  if (!names.length) return origin.label;
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

// The turn an activity item starts, or null when it should render in full:
// anything that needs the reader's eyes (a pending approval, a plan, an
// error) stays out of the fold. `limit` is where a turn must stop (the next
// undone range).
export function eventTurnAt(
  items: ChatItem[],
  start: number,
  limit = items.length
): { turn: EventTurn; end: number } | null {
  const user = items[start];
  if (user.kind !== "user") return null;
  const origin = activityOrigin(user);
  if (!origin) return null;
  let end = start + 1;
  let ended = false;
  while (end < limit) {
    const item = items[end];
    if (item.kind === "user" || item.kind === "undo") break;
    end++;
    if (item.kind === "turn_end") {
      ended = true;
      break;
    }
  }
  const replies = items.slice(start + 1, end);
  const needsReader = replies.some(
    (i) =>
      i.kind === "plan" ||
      i.kind === "error" ||
      (i.kind === "approval" && i.status === "pending")
  );
  if (needsReader) return null;
  const reply = replies.find((i) => i.kind === "assistant" && i.text.trim());
  const body = eventParts(user, origin).body;
  return {
    end,
    turn: {
      id: user.id,
      user,
      origin,
      replies,
      summary: plainSummary(reply?.kind === "assistant" ? reply.text : body),
      task: taskName(origin),
      at: user.createdAt,
      live: !ended && end >= items.length,
      hasQuestion: replies.some(isQuestionTool),
    },
  };
}
