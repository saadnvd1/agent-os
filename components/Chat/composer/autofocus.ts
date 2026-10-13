import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { isPhoneLayout } from "./layout";

// Whether a composer just shown (a session or draft opened) may take the
// caret, so its conversation can be typed into straight away. Not in the phone
// layout (MobileView), where it would raise the keyboard over the
// conversation, and never from someone busy elsewhere: typing in another
// field, selecting text, or already working inside this panel. With a dialog
// or menu open it waits: one that opened the session (⌘K) is about to close
// and hand focus back.
//
// The rule follows the layout, not `pointer: coarse`: an iPad shows the
// desktop layout with a coarse pointer (often with a keyboard attached), and
// is meant to type straight away. A raised on-screen keyboard there is
// accepted. Width is what picks the layout, so touch laptops are covered too.

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

// A hidden field focused inside a tap, to be handed to the editor once it
// mounts (see focusComposerInGesture).
const PROXY = "[data-composer-proxy]";

export function focusVerdict(
  editor: HTMLElement,
  phone: boolean
): FocusVerdict {
  if (phone) return "leave";
  return verdictFor(editor.ownerDocument, editor);
}

function verdictFor(
  doc: Document,
  editor: HTMLElement | null,
  panel: Element | null = editor?.closest("[data-composer-scope]") ?? null
): FocusVerdict {
  if (doc.querySelector(OPEN_ON_TOP)) return "wait";
  const selection = doc.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    !editor?.contains(selection.anchorNode)
  )
    return "leave";
  const active = doc.activeElement;
  if (!active || active === doc.body || editor?.contains(active)) return "take";
  // Still in a dialog on its way out (⌘K's search box as it closes).
  if (active.closest(DIALOG)) return "wait";
  if (active.closest(PROXY)) return "take";
  if (active.closest(EDITABLE)) return "leave";
  // The panel it belongs to (a chat, a draft): focus already inside it stays
  // where the user put it.
  return panel && panel !== active && panel.contains(active) ? "leave" : "take";
}

const PANEL = "[data-composer-scope]";
const COMPOSER = '.chat-composer [contenteditable="true"]';
const PROXY_MS = 3000;

// Hidden tabs are display:none, and every tab of every pane stays mounted.
const visible = (el: Element) => el.getClientRects().length > 0;

// iOS WebKit only honours focus() inside the tap or key press that asked for
// it, and a session's composer is focused later (after it reconnects). So the
// handler that selects a chat session from a real gesture (a sidebar tap, ⌘K,
// the keyboard switch) calls this, synchronously: it focuses the composer
// showing in `pane` (the one the session opens into) if there is one, else a
// hidden field that useFocusOnShow hands over to the editor when it mounts
// (focus moving on from a focused element is allowed). Never for a terminal
// session, whose keystrokes the hidden field would take. Other browsers don't
// need it; the late focus works there.
export function focusComposerInGesture(
  pane: Element | null,
  session: { view?: string },
  doc: Document = document
) {
  if (session.view !== "chat" || isPhoneLayout()) return;
  const panel =
    [...(pane?.querySelectorAll(PANEL) ?? [])].find(visible) ?? null;
  const editor =
    [...(panel?.querySelectorAll<HTMLElement>(COMPOSER) ?? [])].find(visible) ??
    null;
  if (verdictFor(doc, editor, panel) !== "take") return;
  if (editor) {
    editor.focus({ preventScroll: true });
    return;
  }
  if (doc.querySelector(PROXY)) return;
  const proxy = doc.createElement("textarea");
  proxy.setAttribute("data-composer-proxy", "");
  proxy.setAttribute("aria-hidden", "true");
  proxy.tabIndex = -1;
  // 16px: iOS zooms into smaller fields. Offscreen, not display:none, which
  // can't take focus.
  proxy.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;font-size:16px";
  doc.body.append(proxy);
  proxy.focus({ preventScroll: true });
  setTimeout(() => proxy.remove(), PROXY_MS);
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
  phone: boolean,
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
      doc.querySelectorAll(PROXY).forEach((el) => el.remove());
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
      const verdict = focusVerdict(editor.view.dom, phone);
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
  }, [editor, key, phone, disabled]);
}
