// Esc stops a running turn, as it does in Claude Code's terminal, unless
// something on top (a menu, a dialog, the command list, an image) takes it
// first: those close and the turn goes on. Checked as the key goes down,
// before anything handles it: the editor swallows every Esc, and a menu that
// takes one is gone by the time it would bubble up.

export interface EscapeKey {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// Whatever Radix or the composer has open that Esc should close instead.
export const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
  // Something editing in place (a queued message) that Esc cancels.
  "[data-esc-local]",
].join(",");

// Ghost text in the composer: Esc sets it aside, and the turn goes on.
export const GHOST_SELECTOR = "[data-composer-ghost]";

export function escapeInterrupts(
  e: EscapeKey,
  running: boolean,
  overlayOpen: boolean
): boolean {
  return escapeAction(e, running, overlayOpen, false) === "interrupt";
}

// What Esc does in a chat: set the composer's suggestion aside, stop the
// turn, or nothing (something on top takes it, or it isn't a bare Esc).
export function escapeAction(
  e: EscapeKey,
  running: boolean,
  overlayOpen: boolean,
  ghostShown: boolean
): "dismiss" | "interrupt" | null {
  const bare =
    e.key === "Escape" &&
    !e.repeat &&
    !e.isComposing &&
    !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
  if (!bare || overlayOpen) return null;
  if (ghostShown) return "dismiss";
  return running ? "interrupt" : null;
}
