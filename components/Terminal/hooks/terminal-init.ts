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

  // Handle Cmd+A and Cmd+C via container event listener (more reliable than attachCustomKeyEventHandler)
  const handleKeyDown = (event: KeyboardEvent) => {
    // Only handle when terminal is focused
    if (!container.contains(document.activeElement)) return;

    const key = event.key.toLowerCase();

    // Cmd+A (macOS) / Ctrl+A for select all
    if ((event.metaKey || event.ctrlKey) && key === "a") {
      event.preventDefault();
      event.stopPropagation();
      term.selectAll();
      return;
    }

    // Cmd+C (macOS) / Ctrl+C for copy when text is selected
    if ((event.metaKey || event.ctrlKey) && key === "c") {
      const selection = term.getSelection();
      if (selection) {
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard.writeText(selection);
      }
    }
  };

  // Use capture phase to intercept before browser default
  document.addEventListener("keydown", handleKeyDown, true);

  return { term, fitAddon, searchAddon };
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
