"use client";

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { CanvasAddon } from "@xterm/addon-canvas";
import { getTerminalThemeForApp } from "../constants";

export interface TerminalInstance {
  term: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  cleanup: () => void;
}

export function createTerminal(
  container: HTMLElement,
  isMobile: boolean,
  theme: string
): TerminalInstance {
  const fontSize = isMobile ? 11 : 14;
  const terminalTheme = getTerminalThemeForApp(theme || "dark");

  const term = new XTerm({
    cursorBlink: true,
    fontSize,
    fontFamily:
      '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    lineHeight: isMobile ? 1.15 : 1.2,
    scrollback: 15000,
    scrollSensitivity: isMobile ? 3 : 1,
    fastScrollSensitivity: 5,
    smoothScrollDuration: 100,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowProposedApi: true,
    theme: terminalTheme,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(container);
  term.loadAddon(new CanvasAddon());
  fitAddon.fit();

  // Helper to copy text to clipboard with fallback
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback if clipboard API fails
        execCommandCopy(text);
      });
    } else {
      // Fallback for non-secure contexts
      execCommandCopy(text);
    }
  };

  const execCommandCopy = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  // True when focus is on an editable field outside the terminal
  // (e.g. the search bar) — we must not hijack their copy/select.
  const isExternalFormFieldFocused = () => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || container.contains(active)) return false;
    return (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable
    );
  };

  // Handle Cmd+A and Cmd+C via document event listener (more reliable than attachCustomKeyEventHandler)
  const handleKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();

    // Cmd+A (macOS) / Ctrl+A for select all — only when terminal is focused
    if ((event.metaKey || event.ctrlKey) && key === "a") {
      if (!container.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      term.selectAll();
      return;
    }

    // Cmd+C (macOS) / Ctrl+C: copy whenever the terminal has a selection.
    // We can't rely on focus being inside the container — a mouse drag
    // often leaves focus on <body>.
    if ((event.metaKey || event.ctrlKey) && key === "c") {
      if (isExternalFormFieldFocused()) return;
      if (!term.hasSelection()) return;
      const selection = term.getSelection();
      if (selection) {
        event.preventDefault();
        event.stopPropagation();
        copyToClipboard(selection);
      }
    }
  };

  // Auto-copy after a mouse-drag selection (iTerm/tmux-style).
  const handleMouseUp = () => {
    if (!term.hasSelection()) return;
    const selection = term.getSelection();
    if (selection) copyToClipboard(selection);
  };

  // Use capture phase to intercept before browser default
  document.addEventListener("keydown", handleKeyDown, true);
  container.addEventListener("mouseup", handleMouseUp);

  const cleanup = () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    container.removeEventListener("mouseup", handleMouseUp);
  };

  return { term, fitAddon, searchAddon, cleanup };
}

export function updateTerminalForMobile(
  term: XTerm,
  fitAddon: FitAddon,
  isMobile: boolean,
  sendResize: (cols: number, rows: number) => void
): void {
  const newFontSize = isMobile ? 11 : 14;
  const newLineHeight = isMobile ? 1.15 : 1.2;

  if (term.options.fontSize !== newFontSize) {
    term.options.fontSize = newFontSize;
    term.options.lineHeight = newLineHeight;
    term.refresh(0, term.rows - 1);
    fitAddon.fit();
    sendResize(term.cols, term.rows);
  }
}

export function updateTerminalTheme(term: XTerm, theme: string): void {
  const terminalTheme = getTerminalThemeForApp(theme || "dark");
  term.options.theme = terminalTheme;
}
