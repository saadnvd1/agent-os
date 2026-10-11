import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

// Whether a composer just shown (a session or draft opened) may take the
// caret, so its conversation can be typed into straight away. Not on a touch
// screen, where it would raise the keyboard over the conversation, and never
// from someone busy elsewhere: typing in another field, selecting text, or
// already working inside this panel. With a dialog or menu open it waits:
// one that opened the session (⌘K) is about to close and hand focus back.

// Something open on top that keeps the focus it has.
const OPEN_ON_TOP = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  "dialog[open]",
].join(",");

const DIALOG = '[role="dialog"], [role="alertdialog"], dialog';

const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export type FocusVerdict = "take" | "wait" | "leave";

export function focusVerdict(
  editor: HTMLElement,
  coarse: boolean
): FocusVerdict {
  if (coarse) return "leave";
  const doc = editor.ownerDocument;
  if (doc.querySelector(OPEN_ON_TOP)) return "wait";
  const selection = doc.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    !editor.contains(selection.anchorNode)
  )
    return "leave";
  const active = doc.activeElement;
  if (!active || active === doc.body || editor.contains(active)) return "take";
  // Still in a dialog on its way out (⌘K's search box as it closes).
  if (active.closest(DIALOG)) return "wait";
  if (active.closest(EDITABLE)) return "leave";
  // The panel it belongs to (a chat, a draft): focus already inside it stays
  // where the user put it.
  const scope = editor.closest("[data-composer-scope]");
  return scope && scope !== active && scope.contains(active) ? "leave" : "take";
}

// How long a session opened from a dialog waits for it to close.
export const DIALOG_WAIT_MS = 1500;

// Puts the caret at the end of the composer each time `key` changes to a new
// one (the conversation shown), once the editor is there and enabled, when it
// may. A session's chat reconnects as it opens, which disables the editor and
// drops the caret: it comes back unless the user has moved it since.
export function useFocusOnShow(
  editor: Editor | null,
  key: string | null | undefined,
  coarse: boolean,
  disabled = false
) {
  const shown = useRef<string | null>(null);
  // Shown and not yet focused or set aside: until when it may still wait.
  const pending = useRef<number | null>(null);
  // Focus this hook gave, until the user moves it.
  const holding = useRef(false);
  useEffect(() => {
    if (!editor) return;
    // Leaving an editable editor is the user's move; losing it to a
    // disable is not.
    const onBlur = () => {
      if (editor.isEditable) holding.current = false;
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("blur", onBlur);
    };
  }, [editor]);
  useEffect(() => {
    if (!key) {
      shown.current = null;
      pending.current = null;
      holding.current = false;
      return;
    }
    if (shown.current !== key) {
      shown.current = key;
      pending.current = Date.now() + DIALOG_WAIT_MS;
      holding.current = false;
    }
    if (!editor || disabled) return;
    const doc = editor.view.dom.ownerDocument;
    const take = (at: "end" | null) => {
      pending.current = null;
      editor.commands.focus(at, { scrollIntoView: false });
      holding.current = true;
    };
    if (pending.current === null) {
      const dropped = !doc.activeElement || doc.activeElement === doc.body;
      if (holding.current && dropped) take(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // `settled`: no dialog was seen closing just now.
    const decide = (settled: boolean) => {
      const verdict = focusVerdict(editor.view.dom, coarse);
      if (verdict === "take" && settled) return take("end");
      // A dialog just closed and hands focus back on a timer of its own:
      // decide after that.
      if (verdict === "take") timer = setTimeout(() => decide(true), 0);
      else if (verdict === "wait" && Date.now() < pending.current!)
        timer = setTimeout(() => decide(false), 50);
      else pending.current = null;
    };
    decide(true);
    return () => clearTimeout(timer);
  }, [editor, key, coarse, disabled]);
}
