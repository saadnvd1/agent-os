import type { ChatItem } from "./events";

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export type TimelineBlock =
  | { type: "item"; item: ChatItem }
  | { type: "tools"; id: string; tools: ToolItem[] };

// Consecutive tool calls (and the reasoning between them) fold into one
// collapsible block, so a long turn reads as what was said, not every step.
export function groupTimeline(items: ChatItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let tools: ToolItem[] = [];
  const flush = () => {
    if (tools.length) blocks.push({ type: "tools", id: tools[0].id, tools });
    tools = [];
  };
  for (const item of items) {
    if (item.kind === "tool") {
      tools.push(item);
    } else if (item.kind === "reasoning" && tools.length) {
      continue;
    } else {
      flush();
      blocks.push({ type: "item", item });
    }
  }
  flush();
  return blocks;
}
