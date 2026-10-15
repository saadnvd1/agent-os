import type { ChatItem } from "./events";
import { activityOrigin } from "./turns";

// Activity sent while a turn runs is saved when sent but read by the agent
// once that turn ends. It moves to after the turn's end, so the turn a
// person's message started stays whole and the activity gets its own reply.
//
// Several waiting at one turn's end are taken a turn each: the first starts
// after the end, the next after the following one. Whether the agent
// answers them together or apart isn't recorded, and this way a turn each
// keeps every reply with its own event; answered together, the first takes
// the reply and the rest show as bare rows.
//
// A message saved with `midTurn` is trusted either way. Only history from
// before the field is guessed, from whether a turn was open when it landed.
export function readingOrder(items: ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  const waiting: ChatItem[] = [];
  let open = false;
  let moved = false;
  const release = () => out.push(...waiting.splice(0));
  for (const item of items) {
    if (item.kind === "user") {
      const waits = item.midTurn === undefined ? open : item.midTurn;
      if (waits && activityOrigin(item)) {
        waiting.push(item);
        moved = true;
        continue;
      }
      release();
      out.push(item);
      open = true;
    } else if (item.kind === "turn_end") {
      out.push(item);
      open = false;
      const next = waiting.shift();
      if (next) out.push(next);
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
