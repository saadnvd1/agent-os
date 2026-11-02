/**
 * Where a conversation is cut for a fork. A parent that runs `aos fork` is
 * inside a turn whose own tool call has no result yet, so the cut is the
 * last entry after which every tool call so far has its result: nothing
 * dangling, and every earlier step of the turn kept.
 */

export interface TranscriptEntry {
  type: string;
  uuid: string;
  message?: unknown;
  parent_tool_use_id?: string | null;
}

interface Block {
  type?: string;
  id?: string;
  tool_use_id?: string;
}

const blocks = (entry: TranscriptEntry): Block[] => {
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
};

// The uuid of the entry to cut at, or null when nothing is safe to keep.
export function cutPoint(entries: TranscriptEntry[]): string | null {
  const open = new Set<string>();
  let cut: string | null = null;
  for (const entry of entries) {
    if (entry.parent_tool_use_id) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    for (const block of blocks(entry)) {
      if (block.type === "tool_use" && block.id) open.add(block.id);
      if (block.type === "tool_result" && block.tool_use_id)
        open.delete(block.tool_use_id);
    }
    if (open.size === 0) cut = entry.uuid;
  }
  return cut;
}
