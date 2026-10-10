import type { ChatItem } from "./events";

// What the reader sent in this conversation, newest first: what ↑ walks.
// Messages from other agents aren't theirs to recall.
export function sentPrompts(items: ChatItem[]): string[] {
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "user" || item.peer || item.from || item.origin) continue;
    const text = item.text.trim();
    if (text && text !== out[out.length - 1]) out.push(text);
  }
  return out;
}

export interface HistoryState {
  history: string[];
  // Which entry is showing, newest first; -1 when none is.
  index: number;
  text: string;
  firstLine: boolean;
  lastLine: boolean;
}

// ↑ and ↓ in the composer. ↑ starts from an empty composer, with the caret
// on the first line, and goes further back; ↓ comes forward and, past the
// newest, back to empty. Once the recalled text is edited it's the reader's
// draft, and the arrows move the caret again. Null when the key isn't ours.
export function historyStep(
  s: HistoryState,
  dir: "up" | "down"
): { index: number; text: string } | null {
  const browsing = s.index >= 0 && s.text === s.history[s.index];
  if (dir === "up") {
    if (!s.firstLine || (!browsing && s.text !== "")) return null;
    const index = browsing ? s.index + 1 : 0;
    if (index >= s.history.length) return null;
    return { index, text: s.history[index] };
  }
  if (!browsing || !s.lastLine) return null;
  const index = s.index - 1;
  return { index, text: index >= 0 ? s.history[index] : "" };
}
