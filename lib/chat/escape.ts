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
].join(",");

export function escapeInterrupts(
  e: EscapeKey,
  running: boolean,
  overlayOpen: boolean
): boolean {
  return (
    running &&
    e.key === "Escape" &&
    !e.repeat &&
    !e.isComposing &&
    !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) &&
    !overlayOpen
  );
}
