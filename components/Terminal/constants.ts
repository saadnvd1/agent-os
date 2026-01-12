/**
 * Terminal constants and theme configuration
 */

// Reconnection constants
export const WS_RECONNECT_BASE_DELAY = 1000; // 1 second
export const WS_RECONNECT_MAX_DELAY = 30000; // 30 seconds

// xterm.js theme - purple theme to match AgentOS
export const TERMINAL_THEME = {
  background: '#09090b',
  foreground: '#fafafa',
  cursor: '#a855f7', // Purple cursor
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(168, 85, 247, 0.3)', // Purple selection
  selectionForeground: '#ffffff',
  black: '#09090b',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#fafafa',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};
