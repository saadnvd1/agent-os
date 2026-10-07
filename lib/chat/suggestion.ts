// The agent's guess at the next message (sent after each turn but the
// first) shows in an empty composer: as ghost text with a keyboard, as a
// chip to tap without one.

export interface SuggestionView {
  // The latest guess, or null.
  suggestion: string | null;
  // The guess the reader set aside (typed, or pressed Esc); it stays hidden.
  dismissed: string | null;
  text: string;
}

// The guess still on offer: there is one, the reader hasn't set it aside,
// and the composer is empty.
export function offeredSuggestion(v: SuggestionView): string | null {
  if (!v.suggestion || v.suggestion === v.dismissed) return null;
  return v.text.length === 0 ? v.suggestion : null;
}

export interface AcceptKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

// Tab, or → with the caret at the end, takes the ghost text as typed. An
// empty composer has its caret at the end, but → is checked anyway: the
// guess may outlive the text it was offered over by a keystroke.
export function acceptsSuggestion(
  e: AcceptKey,
  offered: boolean,
  caretAtEnd: boolean
): boolean {
  if (!offered || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)
    return false;
  return e.key === "Tab" || (e.key === "ArrowRight" && caretAtEnd);
}
