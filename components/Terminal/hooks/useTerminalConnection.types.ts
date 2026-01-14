'use client';

import type { RefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';

export interface TerminalScrollState {
  scrollTop: number;
  cursorY: number;
  baseY: number;
}

export interface UseTerminalConnectionProps {
  terminalRef: RefObject<HTMLDivElement | null>;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
  isMobile?: boolean;
  theme?: string;
  selectMode?: boolean;
}

export interface UseTerminalConnectionReturn {
  connected: boolean;
  connectionState: 'connected' | 'disconnected' | 'reconnecting';
  isAtBottom: boolean;
  xtermRef: RefObject<XTerm | null>;
  searchAddonRef: RefObject<SearchAddon | null>;
  scrollToBottom: () => void;
  copySelection: () => boolean;
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  focus: () => void;
  getScrollState: () => TerminalScrollState | null;
  restoreScrollState: (state: TerminalScrollState) => void;
  triggerResize: () => void;
  reconnect: () => void;
}
