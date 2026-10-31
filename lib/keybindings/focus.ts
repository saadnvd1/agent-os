const NON_TEXT = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
]);

// Whether a vertical-arrow chord should be left to the focused field: it has
// text, so ⌘↑/⌘↓ move its caret. An empty field, a terminal, or no field
// at all lets the app have the key. A dialog (the palette) keeps its keys.
export function fieldOwnsKey(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.closest(".xterm")) return false;
  if (el.closest('[role="dialog"]')) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return (el as HTMLTextAreaElement).value.length > 0;
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    return !NON_TEXT.has(input.type) && input.value.length > 0;
  }
  if (el.isContentEditable) return (el.textContent ?? "").trim().length > 0;
  return false;
}

// Whether a bare letter is free for the app: nothing is being typed into, no
// terminal or dialog holds the key, and no menu is open.
export function isFreeTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return true;
  if (el.closest(".xterm")) return false;
  if (el.closest('[role="dialog"],[role="menu"],[role="listbox"]'))
    return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return false;
  if (tag === "INPUT") return NON_TEXT.has((el as HTMLInputElement).type);
  return !(
    el.isContentEditable ||
    el.closest('[contenteditable]:not([contenteditable="false"])')
  );
}
