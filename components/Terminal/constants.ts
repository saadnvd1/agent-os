/**
 * Terminal constants and theme configuration
 */

// Reconnection constants
export const WS_RECONNECT_BASE_DELAY = 1000; // 1 second
export const WS_RECONNECT_MAX_DELAY = 30000; // 30 seconds

// xterm.js dark theme - purple theme to match AgentOS
export const TERMINAL_THEME_DARK = {
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

// xterm.js light theme - Termius inspired
export const TERMINAL_THEME_LIGHT = {
  background: '#d6dde0',
  foreground: '#333649',
  cursor: '#7c3aed', // Purple cursor to match AgentOS
  cursorAccent: '#d6dde0',
  selectionBackground: 'rgba(124, 58, 237, 0.25)', // Purple selection to match AgentOS
  selectionForeground: '#333649',
  black: '#141728',
  red: '#c24c48',
  green: '#57b26f',
  yellow: '#d4a520',
  blue: '#1c4774',
  magenta: '#e16866',
  cyan: '#3166a6',
  white: '#a7b2b9',
  brightBlack: '#333649',
  brightRed: '#e06c75',
  brightGreen: '#7bc88c',
  brightYellow: '#e5c07b',
  brightBlue: '#4a90c2',
  brightMagenta: '#e89896',
  brightCyan: '#5b9fd4',
  brightWhite: '#f0f4f5',
};

// Legacy export for compatibility
export const TERMINAL_THEME = TERMINAL_THEME_DARK;
