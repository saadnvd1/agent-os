/**
 * Terminal theme definitions for xterm.js
 * Maps UI themes to terminal color palettes
 */

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// Base ANSI colors for dark themes
const DARK_ANSI = {
  black: "#1a1a1a",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#6272a4",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
  white: "#f8f8f2",
  brightBlack: "#6272a4",
  brightRed: "#ff6e6e",
  brightGreen: "#69ff94",
  brightYellow: "#ffffa5",
  brightBlue: "#d6acff",
  brightMagenta: "#ff92df",
  brightCyan: "#a4ffff",
  brightWhite: "#ffffff",
};

// Base ANSI colors for light themes
const LIGHT_ANSI = {
  black: "#000000",
  red: "#c91b00",
  green: "#00c200",
  yellow: "#c7c400",
  blue: "#0225c7",
  magenta: "#c930c7",
  cyan: "#00c5c7",
  white: "#c7c7c7",
  brightBlack: "#686868",
  brightRed: "#ff6e67",
  brightGreen: "#5ffa68",
  brightYellow: "#fffc67",
  brightBlue: "#6871ff",
  brightMagenta: "#ff76ff",
  brightCyan: "#5ffdff",
  brightWhite: "#ffffff",
};

// Dark theme terminal configurations
const DARK_TERMINALS: Record<string, Partial<TerminalTheme>> = {
  deep: {
    background: "#0A0A0A",
    foreground: "#EBEBEB",
    cursor: "#3B82F6",
    cursorAccent: "#0A0A0A",
    selectionBackground: "#3B82F640",
  },
  charcoal: {
    background: "#161A1D",
    foreground: "#E8EAEB",
    cursor: "#5B9BD5",
    cursorAccent: "#161A1D",
    selectionBackground: "#5B9BD540",
  },
  warm: {
    background: "#1A1612",
    foreground: "#E8DCC8",
    cursor: "#F59E0B",
    cursorAccent: "#1A1612",
    selectionBackground: "#F59E0B40",
    yellow: "#F59E0B",
    brightYellow: "#FBBF24",
  },
  cool: {
    background: "#0D1117",
    foreground: "#E6EDF3",
    cursor: "#58A6FF",
    cursorAccent: "#0D1117",
    selectionBackground: "#58A6FF40",
    blue: "#58A6FF",
    brightBlue: "#79C0FF",
  },
  gray: {
    background: "#191919",
    foreground: "#DEDEDE",
    cursor: "#2383E2",
    cursorAccent: "#191919",
    selectionBackground: "#2383E240",
  },
  midnight: {
    background: "#0A0E1A",
    foreground: "#E5E9F0",
    cursor: "#88C0D0",
    cursorAccent: "#0A0E1A",
    selectionBackground: "#88C0D040",
    cyan: "#88C0D0",
    blue: "#5E81AC",
    brightCyan: "#8FBCBB",
    brightBlue: "#81A1C1",
  },
  forest: {
    background: "#0C1410",
    foreground: "#E8F0ED",
    cursor: "#50C878",
    cursorAccent: "#0C1410",
    selectionBackground: "#50C87840",
    green: "#50C878",
    brightGreen: "#6EE7A0",
  },
  purple: {
    background: "#0F0A1A",
    foreground: "#E8E5F0",
    cursor: "#A855F7",
    cursorAccent: "#0F0A1A",
    selectionBackground: "#A855F740",
    magenta: "#A855F7",
    brightMagenta: "#C084FC",
  },
  ocean: {
    background: "#0A1419",
    foreground: "#E5EBF0",
    cursor: "#14B8A6",
    cursorAccent: "#0A1419",
    selectionBackground: "#14B8A640",
    cyan: "#14B8A6",
    brightCyan: "#2DD4BF",
  },
  mocha: {
    background: "#1C1612",
    foreground: "#E6DDD4",
    cursor: "#D4844A",
    cursorAccent: "#1C1612",
    selectionBackground: "#D4844A40",
    yellow: "#D4844A",
    brightYellow: "#E8A76A",
  },
};

// Light theme terminal configurations
const LIGHT_TERMINALS: Record<string, Partial<TerminalTheme>> = {
  default: {
    background: "#FFFFFF",
    foreground: "#1a1a1a",
    cursor: "#3B82F6",
    cursorAccent: "#FFFFFF",
    selectionBackground: "#3B82F630",
  },
  warm: {
    background: "#F5F1E8",
    foreground: "#2D2519",
    cursor: "#D97706",
    cursorAccent: "#F5F1E8",
    selectionBackground: "#D9770630",
  },
  cool: {
    background: "#F0F4F8",
    foreground: "#1E293B",
    cursor: "#0EA5E9",
    cursorAccent: "#F0F4F8",
    selectionBackground: "#0EA5E930",
  },
  soft: {
    background: "#F8F9FA",
    foreground: "#212529",
    cursor: "#6366F1",
    cursorAccent: "#F8F9FA",
    selectionBackground: "#6366F130",
  },
  rose: {
    background: "#FAF5F7",
    foreground: "#2D1A22",
    cursor: "#E74C8C",
    cursorAccent: "#FAF5F7",
    selectionBackground: "#E74C8C30",
  },
  lavender: {
    background: "#F7F5FA",
    foreground: "#1F1A2D",
    cursor: "#9F7AEA",
    cursorAccent: "#F7F5FA",
    selectionBackground: "#9F7AEA30",
  },
  mint: {
    background: "#F0F9F6",
    foreground: "#14291F",
    cursor: "#28B88B",
    cursorAccent: "#F0F9F6",
    selectionBackground: "#28B88B30",
  },
  peach: {
    background: "#F9F4F0",
    foreground: "#2D1F19",
    cursor: "#FA8B6C",
    cursorAccent: "#F9F4F0",
    selectionBackground: "#FA8B6C30",
  },
};

/**
 * Get terminal theme for a given app theme string
 * @param theme - Theme string like "dark", "dark-purple", "light-warm", etc.
 */
export function getTerminalTheme(theme: string): TerminalTheme {
  // Handle system theme - default to dark
  if (theme === "system") {
    return buildTerminalTheme("dark", "deep");
  }

  // Parse theme string
  const parts = theme.split("-");
  const mode = parts[0] as "light" | "dark";
  const variant = parts[1] || (mode === "dark" ? "deep" : "default");

  return buildTerminalTheme(mode, variant);
}

function buildTerminalTheme(
  mode: "light" | "dark",
  variant: string
): TerminalTheme {
  if (mode === "light") {
    const config = LIGHT_TERMINALS[variant] || LIGHT_TERMINALS.default;
    return {
      ...LIGHT_ANSI,
      background: config.background!,
      foreground: config.foreground!,
      cursor: config.cursor!,
      cursorAccent: config.cursorAccent!,
      selectionBackground: config.selectionBackground!,
      ...config,
    } as TerminalTheme;
  }

  const config = DARK_TERMINALS[variant] || DARK_TERMINALS.deep;
  return {
    ...DARK_ANSI,
    background: config.background!,
    foreground: config.foreground!,
    cursor: config.cursor!,
    cursorAccent: config.cursorAccent!,
    selectionBackground: config.selectionBackground!,
    ...config,
  } as TerminalTheme;
}
