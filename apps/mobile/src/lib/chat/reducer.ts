// Applying /ws/chat server messages to the view, the same way the web's
// useChat does: a snapshot replaces, an item upserts by id, a delta appends.
import type {
  ChatItem,
  ChatServerMessage,
  ChatState,
  QueuedMessage,
} from "@/lib/chat/events";

// What the composer's pills and slash menu offer for this session.
export type ChatCaps = Omit<
  Extract<ChatServerMessage, { type: "capabilities" }>,
  "type"
>;

export interface ChatView {
  loaded: boolean;
  items: ChatItem[];
  state: ChatState;
  queue: QueuedMessage[];
  suggestion: string | null;
  caps: ChatCaps | null;
}

export const EMPTY_CHAT: ChatView = {
  loaded: false,
  items: [],
  state: "idle",
  queue: [],
  suggestion: null,
  caps: null,
};

function indexOf(items: ChatItem[], id: string): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].id === id) return i;
  return -1;
}

export function applyChatMessage(
  view: ChatView,
  msg: ChatServerMessage
): ChatView {
  switch (msg.type) {
    case "snapshot":
      return {
        ...view,
        loaded: true,
        items: msg.items,
        state: msg.state,
        queue: msg.queue,
        suggestion: msg.suggestion,
      };
    case "item": {
      const i = indexOf(view.items, msg.item.id);
      const items =
        i < 0
          ? [...view.items, msg.item]
          : view.items.map((it, n) => (n === i ? msg.item : it));
      return { ...view, items };
    }
    case "delta": {
      const i = indexOf(view.items, msg.id);
      const target = view.items[i];
      if (!target || !("text" in target)) return view;
      const items = [...view.items];
      items[i] = { ...target, text: target.text + msg.text } as ChatItem;
      return { ...view, items };
    }
    case "state":
      return { ...view, state: msg.state };
    case "queue":
      return { ...view, queue: msg.queue };
    case "suggestion":
      return { ...view, suggestion: msg.text };
    case "capabilities": {
      const { type: _type, ...caps } = msg;
      return { ...view, caps };
    }
    default:
      return view;
  }
}

// The user message whose turn is running, for "Send now" (the web sends the
// same `during`, so only that turn is stopped).
export function runningTurn(view: ChatView): string | undefined {
  if (view.state !== "running" && view.state !== "waiting") return undefined;
  for (let i = view.items.length - 1; i >= 0; i--)
    if (view.items[i].kind === "user") return view.items[i].id;
  return undefined;
}
