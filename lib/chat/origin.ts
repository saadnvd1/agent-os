import type { ChatItem, ChatOrigin } from "./events";

type UserItem = Extract<ChatItem, { kind: "user" }>;

// Items saved before messages were tagged at the source. Only these are
// matched by their text, so nothing typed since can pass for an event.
export const TAGGED_SINCE = Date.UTC(2026, 9, 11);

// `from` was only ever set by the server, never by a client.
function fromLabel(from: string): ChatOrigin | null {
  if (from === "you") return null;
  if (from === "agentos") return { kind: "event", label: "AgentOS" };
  const schedule = /^Schedule (.+?)(?:, set up by ".*")?$/.exec(from);
  if (schedule) return { kind: "schedule", label: schedule[1] };
  return { kind: "system", label: from };
}

function fromText(text: string): ChatOrigin | null {
  const peer = /^\[AgentOS message from "([^"\n]+)" \([\w-]+\)\]/.exec(text);
  if (peer) return { kind: "peer", label: peer[1] };
  const system = /^\[AgentOS message from ([^\]\n]+) \(via AgentOS\)\]/.exec(
    text
  );
  if (system && system[1] !== "the user")
    return { kind: "system", label: system[1] };
  const schedule = /^\[Scheduled message "([^"\n]+)"/.exec(text);
  if (schedule) return { kind: "schedule", label: schedule[1] };
  return null;
}

// What sent a user item, or null when the reader typed it.
export function originOf(item: UserItem): ChatOrigin | null {
  if (item.origin) return item.origin;
  if (item.peer)
    return {
      kind: "peer",
      label: item.from ?? "Another session",
      sessionId: item.peer.sessionId,
      body: item.peer.body,
    };
  if (item.from) return fromLabel(item.from);
  if (item.createdAt < TAGGED_SINCE) return fromText(item.text);
  return null;
}

export interface EventParts {
  // What the row shows from the sender.
  body: string;
  // The reader's own answers in it, each shown as theirs.
  decided: string[];
}

// The event's body without the reader's answers, which show apart.
export function eventParts(item: UserItem, origin: ChatOrigin): EventParts {
  const peerBody = origin.kind === "peer" ? item.peer?.body : undefined;
  let body = origin.body ?? peerBody ?? item.text;
  const decided = (origin.decided ?? []).filter((d) => body.includes(d));
  for (const d of decided) body = body.replace(d, "");
  return { body: body.replace(/\n{2,}/g, "\n").trim(), decided };
}
