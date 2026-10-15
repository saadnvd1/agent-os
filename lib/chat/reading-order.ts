import type { ChatItem } from "./events";
import { activityOrigin } from "./turns";

// Activity sent while a turn runs is saved when sent but read by the agent
// once that turn ends. It moves to just after the turn's end, so the turn a
// person's message started stays whole and the activity gets its own reply.
// History from before messages carried `midTurn` is read the same way.
export function readingOrder(items: ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  let waiting: ChatItem[] = [];
  let open = false;
  let moved = false;
  const release = () => {
    out.push(...waiting);
    waiting = [];
  };
  for (const item of items) {
    if (item.kind === "user") {
      if ((item.midTurn || open) && activityOrigin(item)) {
        waiting.push(item);
        moved = true;
        continue;
      }
      release();
      out.push(item);
      open = true;
    } else if (item.kind === "turn_end") {
      out.push(item);
      open = waiting.length > 0;
      release();
    } else if (
      item.kind === "undo" ||
      item.kind === "error" ||
      item.kind === "command_output"
    ) {
      release();
      out.push(item);
      open = false;
    } else out.push(item);
  }
  release();
  return moved ? out : items;
}
